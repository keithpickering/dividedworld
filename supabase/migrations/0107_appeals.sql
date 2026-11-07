-- Appeals (the Mod Bots design, section 7 and "Ways out"; its plan, Task 10).
--
-- An appeal is a character's public Act on a punishment of its own: `appeal` (by the punished character, on the `infraction` or the `ban`: its plea, at most 1000
-- characters). The staff member who hears it answers with an `appeal_ruling` (by that staff member, on the appeal): `overturned`, `upheld`, `reduced` or `increased`. The
-- plea and the ruling are a public pair of Acts; neither takes a seq in its thread. The Acts sit in the thread of the post the punishment is about.
--
--   appeal_hearer(punishment)   who hears it: the Mod that filed an infraction, while it is a Mod; else the Mod on the board's beat; else the Boss. A ban is heard by the season's
--                               Boss; with no Boss, the Mod on the board's beat. Null only when there is no one on staff at all (open_appeal then refuses, and says so).
--   open_appeal(through, punishment_act, plea)   the player's door. It verifies the caller plays `through`; it does NOT refuse a banned character (a ban is appealed by the
--                               banned). In this order: acting, the plea (blank, then over 1000), The System on, the punishment (an infraction or ban of THIS character: the same
--                               words for one that is another's and one that is none; and one still in effect, `punishment_running`), someone to hear it, THEN, under the punishment's lock, whether it has been appealed, THEN the
--                               instance's judgment budget (one count with the reports', under the reports' lock), THEN the price (`appealPrice`, wallet_spend, kind 'appeal') and
--                               the `appeal` Act. One appeal per punishment: an appeal that was judged, or is open, counts; one refunded for a failed judgment does not, and the
--                               punishment can be appealed again; one swept for never being judged frees it too, at most three times per punishment (so a client that opens and
--                               abandons appeals cannot make free public pleas without end).
--   close_appeal(appeal, verdict, line, staff)   the service's: writes the ruling by the hearing staff member and its effect, once. `staff` must be who hears it now (a
--                               hearer who left is not the one that judged: the call fails and the appeal is refunded). An infraction: overturned takes all its points
--                               off, reduced half of them (rounded up, at most its points), increased files one more infraction of the same band for the same post (infract, so a
--                               full bar can ban: at most one band's points), upheld changes nothing. A ban: overturned ends it at once, reduced ends it at half its length
--                               counted from its start, increased runs it half its length longer, upheld changes nothing. Overturned refunds the price. The effect is read, never
--                               written over the original: `infraction_relief` and `banned_until` read the rulings.
--   refund_appeal(appeal, why)   the service's: the price back to the account that paid, once, and nothing else is written; refused once the appeal has a ruling.
--   refund_stale_appeals(minutes, most)   refunds each appeal older than that with no ruling and no refund (a judgment that never came back).
--
-- Masks. Nothing here reads who owns a character except the caller check and the wallet the appeal is paid from. The punishments, the plea and the ruling are public Acts,
-- the hearing staff member a public staff character, and the answer open_appeal gives names the appellant's own public name. The refund finds the account in the wallet event
-- that took the price. The budget is one instance-wide count, the same words for everyone.
--
-- Ways out. This is the way out of an infraction or a ban. An appeal whose judgment fails is refunded and can be made again; one whose function died is refunded by
-- refund_stale_appeals; an overturned one gets its Aura back; every ruling is public. Concurrency: an appeal's decisions are made under an advisory lock of its own (close and
-- refund take the same one, so it is closed once or refunded once, never both); opening takes the punishment's lock and then the reports' instance-wide lock for the budget.

-- ------------------------------------------------------------------------------------------------------ the Acts ----

alter table acts drop constraint acts_kind_check;
alter table acts add constraint acts_kind_check check (kind in ('post', 'spin', 'card', 'edit', 'tally', 'reveal', 'unmask', 'move', 'move_end', 'move_keep', 'set', 'spring', 'update', 'card_end', 'describe', 'infraction', 'ban',
  'visit', 'visit_join', 'visit_end', 'report', 'report_verdict', 'intercept', 'appeal', 'appeal_ruling'));

alter table acts drop constraint acts_seq_check;
alter table acts add constraint acts_seq_check check ((kind = 'edit') = (seq is null) or kind in ('card', 'set', 'spring', 'card_end', 'describe', 'infraction', 'ban', 'visit', 'visit_join', 'visit_end', 'report', 'report_verdict', 'intercept',
  'appeal', 'appeal_ruling'));

alter table acts add constraint acts_appeal_payload check (
  case kind
    when 'appeal' then payload - 'plea' = '{}'::jsonb
      and jsonb_typeof(payload -> 'plea') = 'string' and char_length(payload ->> 'plea') between 1 and 1000
    when 'appeal_ruling' then payload - 'appeal_act' - 'verdict' - 'points_delta' - 'line' - 'until' - 'infraction_act' = '{}'::jsonb
      and jsonb_typeof(payload -> 'appeal_act') = 'string' and payload ->> 'appeal_act' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      and payload ->> 'verdict' in ('overturned', 'upheld', 'reduced', 'increased')
      and jsonb_typeof(payload -> 'points_delta') = 'number' and payload ->> 'points_delta' ~ '^-?[0-9]{1,9}$'
      and jsonb_typeof(payload -> 'line') = 'string' and char_length(payload ->> 'line') <= 280
      and (not payload ? 'until' or jsonb_typeof(payload -> 'until') = 'string')
      and (not payload ? 'infraction_act' or (jsonb_typeof(payload -> 'infraction_act') = 'string' and payload ->> 'infraction_act' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'))
    else true
  end is true);

-- One ruling per appeal. Appeals are found by the punishment they are about (open_appeal's one-per-punishment, a ban's effective end, an infraction's relief).
create unique index acts_one_appeal_ruling on acts (target_act_id) where kind = 'appeal_ruling';
create index acts_appeals_by_punishment on acts (target_act_id, created_at) where kind = 'appeal';
create index acts_appeals_by_time on acts (created_at) where kind = 'appeal';

-- acts_take_seq (0106), also leaving an appeal and its ruling out of their thread's seq; everything else as 0106 wrote it.
create or replace function acts_take_seq() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.kind in ('edit', 'card', 'set', 'spring', 'card_end', 'describe', 'infraction', 'ban', 'visit', 'visit_join', 'visit_end', 'report', 'report_verdict', 'intercept', 'appeal', 'appeal_ruling') then
    new.seq := null;
  else
    -- On the right of an assignment a column is its old value: a post that takes a seq above 1 is a reply.
    update threads set next_seq = next_seq + 1, last_at = greatest(last_at, new.created_at),
                       replies = replies + case when new.kind = 'post' and next_seq > 1 then 1 else 0 end
     where id = new.thread returning next_seq - 1 into new.seq;
  end if;
  return new;
end $$;

-- An appeal is a player's character's Act on a punishment of its own, in the punishment's thread, written only by open_appeal; a ruling is a staff character's Act on an
-- appeal, in its thread.
create function acts_appeal_guard() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  t acts%rowtype;
begin
  select * into t from acts where id = new.target_act_id;
  if new.kind = 'appeal' then
    if coalesce(current_setting('kayfabb.appeal_writer', true), '') <> 'on' then
      raise exception 'an appeal is made only through open_appeal' using hint = 'kayfabb.refusal', errcode = '42501';
    end if;
    if new.character is null or exists (select 1 from characters c where c.id = new.character and c.staff is not null) then
      raise exception 'an appeal is a player''s character''s Act' using hint = 'kayfabb.refusal', errcode = '42501';
    end if;
    if t.kind not in ('infraction', 'ban') or t.thread is distinct from new.thread or t.payload ->> 'character' is distinct from new.character::text then
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
revoke execute on function acts_appeal_guard() from public, anon, authenticated;
create trigger acts_appeal_guard before insert on acts for each row when (new.kind in ('appeal', 'appeal_ruling')) execute function acts_appeal_guard();

-- write_staff_act (0105), also writing an appeal's ruling. Everything else as 0105 wrote it.
create or replace function write_staff_act(staff_key text, kind text, thread uuid, target uuid, payload jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  who uuid;
  whose text;
  written uuid;
  held text;
begin
  select c.id, c.staff_kind into who, whose from characters c where c.staff = staff_key;
  if whose = 'developer' then
    raise exception 'the developer speaks only through post_update, by an admin' using errcode = '42501';
  end if;
  if kind is null or kind not in ('post', 'spin', 'card', 'edit', 'move', 'move_keep', 'visit', 'visit_join', 'report_verdict', 'appeal_ruling') then
    raise exception 'a staff character posts, spins, plays a card, edits, moves, keeps a move, visits or gives a verdict or a ruling, not %', coalesce(kind, 'nothing') using errcode = '22023';
  end if;
  if jsonb_typeof(payload) is distinct from 'object' then raise exception 'an Act''s payload is an object' using errcode = '22023'; end if;
  if who is null then raise exception 'there is no staff member "%"', staff_key using errcode = 'P0002'; end if;
  -- A persona that has not debuted writes nothing, and a benched one is silent (0082).
  select o.office into held from staff_office_now o where o.staff = staff_key;
  if held in ('waiting', 'benched') then
    raise exception 'a % persona writes nothing', held using errcode = '55000';
  end if;
  perform set_config('kayfabb.staff_writer', 'on', true);
  insert into acts (character, kind, thread, target_act_id, payload) values (who, kind, thread, target, payload) returning id into written;
  perform set_config('kayfabb.staff_writer', '', true);
  return act_projection(written);
end $$;

-- ---------------------------------------------------------------------------------------------------- the money ----

alter table wallet_events drop constraint wallet_events_kind_check;
alter table wallet_events add constraint wallet_events_kind_check check (kind in ('settlement', 'purchase', 'play', 'trap', 'trapSystem', 'report', 'refund', 'bribe', 'appeal'));

-- An appeal whose price went back. Written once per appeal and never changed. No client reads it.
create table appeal_refunds (
  appeal_act uuid primary key references acts (id),
  amount integer not null check (amount >= 0),
  -- Why: 'failed' (the judgment failed: the punishment can be appealed again), 'stale' (never judged: frees the punishment, at most three times) or 'overturned' (the ruling
  -- gave it back; the appeal stands as judged).
  why text not null default 'failed' check (why in ('failed', 'stale', 'overturned')),
  at timestamptz not null default now()
);
alter table appeal_refunds enable row level security;
revoke all on appeal_refunds from public, anon, authenticated;
create function appeal_refunds_append_only() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  raise exception 'a refund is never edited or removed (%)', tg_op using errcode = 'P0001';
end $$;
create trigger appeal_refunds_no_update before update or delete on appeal_refunds for each row execute function appeal_refunds_append_only();
create trigger appeal_refunds_no_truncate before truncate on appeal_refunds for each statement execute function appeal_refunds_append_only();
alter table appeal_refunds enable always trigger appeal_refunds_no_update;
alter table appeal_refunds enable always trigger appeal_refunds_no_truncate;
revoke execute on function appeal_refunds_append_only() from public, anon, authenticated;

-- ----------------------------------------------------------------------------------------------------- the budget ----

-- judgment_load_today (0105), also counting every appeal paid within the window that is still in flight (no ruling, no refund, and no billed call of its own yet), as it counts
-- reports. Everything else as 0105 wrote it.
create or replace function judgment_load_today() returns integer
language sql stable security definer set search_path = public, pg_temp as $$
  select judgment_calls_today() + (
    select count(*)::integer from acts r
    where r.kind = 'report' and r.created_at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc'
      and r.created_at > now() - report_in_flight_window()
      and not exists (select 1 from acts v where v.kind = 'report_verdict' and v.target_act_id = r.id)
      and not exists (select 1 from report_refunds f where f.report_act = r.id)
      and not exists (select 1 from staff_call_records c where c.cause_act = r.id and c.duty = 'reportJudge')
  ) + (
    select count(*)::integer from acts r
    where r.kind = 'appeal' and r.created_at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc'
      and r.created_at > now() - report_in_flight_window()
      and not exists (select 1 from acts v where v.kind = 'appeal_ruling' and v.target_act_id = r.id)
      and not exists (select 1 from appeal_refunds f where f.appeal_act = r.id)
      and not exists (select 1 from staff_call_records c where c.cause_act = r.id and c.duty = 'appeal'))
$$;
revoke execute on function judgment_load_today() from public, anon, authenticated;
grant execute on function judgment_load_today() to service_role;

-- ------------------------------------------------------------------------------------------------------- the reads ----

-- What an appeal took off an infraction's points: all of them when overturned, half (rounded up) when reduced, nothing for the rest. warn_points subtracts it from each
-- infraction it counts (0102); the original Act is never touched. An increase is not a relief: it is an infraction of its own.
create or replace function infraction_relief(infraction uuid) returns integer
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(max(greatest(0, -(r.payload ->> 'points_delta')::integer)), 0)::integer
  from acts a join acts r on r.kind = 'appeal_ruling' and r.target_act_id = a.id
  where a.kind = 'appeal' and a.target_act_id = infraction_relief.infraction
$$;
revoke execute on function infraction_relief(uuid) from public, anon, authenticated;

-- banned_until (0102): the latest end among the character's bans still running, an appeal's ruling on a ban read in place of the ban's own end (overturned: it ended when the
-- ruling landed; reduced or increased: the end the ruling names). A ban nobody appealed, or one that was upheld, ends when it said.
create or replace function banned_until(who uuid) returns timestamptz
language sql stable security definer set search_path = public, pg_temp as $$
  select max(e.ends)
  from acts b
  cross join lateral (
    select coalesce((select (r.payload ->> 'until')::timestamptz from acts a join acts r on r.kind = 'appeal_ruling' and r.target_act_id = a.id
                     where a.kind = 'appeal' and a.target_act_id = b.id and r.payload ? 'until' limit 1),
                    (b.payload ->> 'until')::timestamptz) as ends
  ) e
  where b.kind = 'ban' and b.payload ->> 'character' = who::text and e.ends > now()
$$;
revoke execute on function banned_until(uuid) from public, anon;
grant execute on function banned_until(uuid) to authenticated, service_role;

-- infract (0102), the ladder not counting a ban an appeal overturned. Everything else as 0102 wrote it.
create or replace function infract(who uuid, band text, about_act uuid, staff text, rule_number integer default null, visit_act uuid default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  bar jsonb;
  pts integer;
  in_thread uuid;
  on_board uuid;
  at timestamptz;
  inf uuid;
  total integer;
  made uuid;
  season_no integer;
  prior integer;
  steps jsonb;
  days integer;
  ends timestamptz;
  ban_at timestamptz;
begin
  if band is null or band not in ('minor', 'moderate', 'severe') then raise exception 'there is no band "%"; a breach is minor, moderate or severe', coalesce(band, '') using errcode = '22023'; end if;
  if staff is null or staff = '' then raise exception 'an infraction names the Mod that filed it' using errcode = '22023'; end if;
  perform 1 from characters c where c.id = who and c.staff is null for no key update;
  if not found then raise exception 'there is no player character to warn' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
  select a.thread, t.board into in_thread, on_board from acts a join threads t on t.id = a.thread where a.id = about_act and a.kind in ('post', 'spin') and a.character = who;
  if in_thread is null then raise exception 'an infraction is for a post this character wrote' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
  if visit_act is not null and not exists (select 1 from acts v where v.id = visit_act) then raise exception 'there is no such visit' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
  -- The time and the bar are taken with the row held: a filing that waited for another's ban lands after it, and sees its bar.
  at := clock_timestamp();
  bar := setting('warnBar');
  pts := (bar -> 'bands' ->> band)::integer;
  perform set_config('kayfabb.warn_writer', 'on', true);
  insert into acts (character, kind, thread, payload, created_at)
  values (null, 'infraction', in_thread,
    jsonb_build_object('character', who, 'band', band, 'points', pts, 'rule_number', rule_number, 'board', on_board, 'about_act', about_act, 'visit_act', visit_act,
                       'staff', staff, 'expires_at', at + span_interval(bar -> 'decay')), at)
  returning id into inf;
  total := warn_points(who);
  if total >= (bar ->> 'size')::integer then
    -- This season's bans of this character, this one counting: a new season has none, so the ladder starts again. A ban an appeal overturned is not counted.
    -- With no season open (between one and the next) it is the latest season's; 0 only where no season was ever made.
    season_no := coalesce((select max(s.number) from seasons s), 0);
    select count(*) into prior from acts b where b.kind = 'ban' and b.payload ->> 'character' = who::text and (b.payload ->> 'season')::integer = season_no
      and not exists (select 1 from acts ap join acts r on r.kind = 'appeal_ruling' and r.target_act_id = ap.id
                      where ap.kind = 'appeal' and ap.target_act_id = b.id and r.payload ->> 'verdict' = 'overturned');
    steps := bar -> 'banDays';
    days := (steps ->> least(prior, jsonb_array_length(steps) - 1))::integer;
    ban_at := greatest(clock_timestamp(), at + interval '1 microsecond');
    ends := ban_at + make_interval(days => days);
    insert into acts (character, kind, thread, payload, created_at)
    values (null, 'ban', in_thread, jsonb_build_object('character', who, 'days', days, 'until', ends, 'infraction_act', inf, 'season', season_no), ban_at)
    returning id into made;
    total := 0;
  end if;
  perform set_config('kayfabb.warn_writer', '', true);
  return jsonb_build_object('infraction', inf, 'points', pts, 'warn_points', total, 'ban', made, 'until', ends);
end $$;
revoke execute on function infract(uuid, text, uuid, text, integer, uuid) from public, anon, authenticated;
grant execute on function infract(uuid, text, uuid, text, integer, uuid) to service_role;

-- ------------------------------------------------------------------------------------------------------- helpers ----

-- The rule an infraction was filed under, in words: the charge of its visit that names its rule and band, else "Rule N", else the premise of the board.
create function punishment_words(infraction uuid) returns text
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  i acts%rowtype;
  words text;
begin
  select * into i from acts a where a.id = punishment_words.infraction and a.kind = 'infraction';
  if not found then return null; end if;
  if jsonb_typeof(i.payload -> 'visit_act') = 'string' then
    select c ->> 'rule' into words from jsonb_array_elements(visit_charges((i.payload ->> 'visit_act')::uuid)) c
    where c ->> 'rule_number' is not distinct from i.payload ->> 'rule_number' and coalesce(c ->> 'rule', '') <> '' limit 1;
  end if;
  return coalesce(words, case when i.payload ->> 'rule_number' is not null then 'Rule ' || (i.payload ->> 'rule_number')
                              else 'the premise of ' || coalesce((select b.name from boards_now b where b.id = (i.payload ->> 'board')::uuid), 'the board') end);
end $$;
revoke execute on function punishment_words(uuid) from public, anon, authenticated;

-- Whether a punishment is still in effect: an infraction that has not expired and landed after the character's last ban (the bar still counts it, as warn_points reads it), a
-- ban that has not run out (its end read through a ruling, as banned_until reads it). An appeal of one that has run out would only change the record, and an increase could
-- revive an ended ban or put fresh points on an expired infraction.
create function punishment_running(punishment uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((
    select case p.kind
      when 'infraction' then (p.payload ->> 'expires_at')::timestamptz > now()
        and p.created_at > coalesce((select max(b.created_at) from acts b where b.kind = 'ban' and b.payload ->> 'character' = p.payload ->> 'character'), '-infinity'::timestamptz)
      else coalesce((select (r.payload ->> 'until')::timestamptz from acts a join acts r on r.kind = 'appeal_ruling' and r.target_act_id = a.id
                     where a.kind = 'appeal' and a.target_act_id = p.id and r.payload ? 'until' limit 1),
                    (p.payload ->> 'until')::timestamptz) > now()
    end
    from acts p where p.id = punishment_running.punishment and p.kind in ('infraction', 'ban')), false)
$$;
revoke execute on function punishment_running(uuid) from public, anon, authenticated;

-- Who hears an appeal of a punishment (see the header). An infraction goes back to the Mod that filed it while that Mod is on staff; if it has left, to the Mod on the board's
-- beat, and with no Mod at all to the Boss. A ban goes to the season's Boss, and with none to the Mod on the beat.
create function appeal_hearer(punishment uuid) returns text
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  p acts%rowtype;
  board uuid;
begin
  select * into p from acts a where a.id = appeal_hearer.punishment and a.kind in ('infraction', 'ban');
  if not found then return null; end if;
  select t.board into board from threads t where t.id = p.thread;
  if p.kind = 'ban' then
    return coalesce(current_boss(), beat_of(board));
  end if;
  if exists (select 1 from staff_now n where n.staff = p.payload ->> 'staff') then return p.payload ->> 'staff'; end if;
  return coalesce(beat_of(board), current_boss());
end $$;
revoke execute on function appeal_hearer(uuid) from public, anon, authenticated;
grant execute on function appeal_hearer(uuid) to service_role;

-- Whether a punishment can not be appealed now: an appeal of it was judged or is open, or three of them were swept for never being judged. A failed one, refunded, does not count.
create function appeal_blocks(punishment uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from acts a where a.kind = 'appeal' and a.target_act_id = appeal_blocks.punishment
                 and not exists (select 1 from appeal_refunds f where f.appeal_act = a.id and f.why in ('failed', 'stale')))
      or (select count(*) from acts a join appeal_refunds f on f.appeal_act = a.id and f.why = 'stale' where a.kind = 'appeal' and a.target_act_id = appeal_blocks.punishment) >= 3
$$;
revoke execute on function appeal_blocks(uuid) from public, anon, authenticated;

-- A hearer's line on an appeal from the instance's stock lines (`appealOverturned`, `appealUpheld`, `appealReduced`, `appealIncreased`): {mod} is the hearer's name and
-- {appellant} the appellant's. Where the instance gave none the plain default says the same.
create function appeal_line(line_key text, staff text, appellant text) returns text
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  lines jsonb;
  mod_name text := coalesce((select c.name from characters c where c.staff = appeal_line.staff), '');
begin
  select s.value -> line_key into lines from settings s where s.key = 'systemLines';
  if jsonb_typeof(lines) = 'array' and jsonb_array_length(lines) > 0 and jsonb_typeof(lines -> 0) = 'string' then
    return left(fill_tokens(lines ->> floor(random() * jsonb_array_length(lines))::integer, jsonb_build_object('mod', mod_name, 'appellant', appellant)), 280);
  end if;
  return case line_key
    when 'appealOverturned' then mod_name || ' heard ' || appellant || '''s appeal and overturned it.'
    when 'appealReduced' then mod_name || ' heard ' || appellant || '''s appeal and reduced it.'
    when 'appealIncreased' then mod_name || ' heard ' || appellant || '''s appeal and increased it.'
    else mod_name || ' heard ' || appellant || '''s appeal and upheld it.' end;
end $$;
revoke execute on function appeal_line(text, text, text) from public, anon, authenticated;

-- ------------------------------------------------------------------------------------------------------ open_appeal ----

create function open_appeal(through uuid, punishment_act uuid, plea text) returns jsonb
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
  -- An infraction or a ban of THIS character: the same words for one that is another's and one that is none.
  select * into pun from acts a where a.id = open_appeal.punishment_act and a.kind in ('infraction', 'ban') and a.payload ->> 'character' = open_appeal.through::text;
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

  select b.id, b.name, b.premise into board from threads t join boards_now b on b.id = t.board where t.id = pun.thread;
  select c.name into me from characters c where c.id = through;
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

create function close_appeal(appeal_act uuid, verdict text, line text default null, staff text default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  ap acts%rowtype;
  pun acts%rowtype;
  ruling acts%rowtype;
  mod_key text;
  who uuid;
  appellant text;
  said text := left(btrim(coalesce(close_appeal.line, '')), 280);
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
begin
  select * into ap from acts a where a.id = close_appeal.appeal_act and a.kind = 'appeal';
  if not found then raise exception 'there is no such appeal' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
  -- The appeal's own lock: closing and refunding it are one decision, so it is closed once, or refunded once, never both.
  perform pg_advisory_xact_lock(hashtextextended('kayfabb.appeal.' || ap.id::text, 0));
  select * into ruling from acts a where a.kind = 'appeal_ruling' and a.target_act_id = ap.id;
  if found then
    return jsonb_build_object('closed', false, 'existing', true, 'ruling_act', ruling.id, 'verdict', ruling.payload ->> 'verdict', 'line', ruling.payload ->> 'line');
  end if;
  if exists (select 1 from appeal_refunds f where f.appeal_act = ap.id) then
    return jsonb_build_object('closed', false, 'refunded', true);
  end if;
  if close_appeal.verdict is null or close_appeal.verdict not in ('overturned', 'upheld', 'reduced', 'increased') then
    raise exception 'an appeal is answered with overturned, upheld, reduced or increased, not %', coalesce(close_appeal.verdict, 'nothing') using errcode = '22023';
  end if;
  select * into pun from acts a where a.id = ap.target_act_id;
  mod_key := appeal_hearer(pun.id);
  if mod_key is null then raise exception 'no one is on staff to hear an appeal' using errcode = '55000'; end if;
  if close_appeal.staff is not null and close_appeal.staff <> mod_key then
    raise exception 'this appeal is heard by someone else now' using errcode = '55000';
  end if;
  who := ap.character;
  appellant := (select c.name from characters c where c.id = who);
  payload := jsonb_build_object('appeal_act', ap.id, 'verdict', close_appeal.verdict);

  if pun.kind = 'infraction' then
    pts := (pun.payload ->> 'points')::integer;
    if close_appeal.verdict = 'overturned' then delta := -pts;
    elsif close_appeal.verdict = 'reduced' then delta := -least(pts, greatest(1, (pts + 1) / 2));
    elsif close_appeal.verdict = 'increased' then
      -- One more infraction of the same band for the same post: at most one band's points, and a full bar bans.
      hit := infract(who, pun.payload ->> 'band', (pun.payload ->> 'about_act')::uuid, mod_key, nullif(pun.payload ->> 'rule_number', '')::integer, nullif(pun.payload ->> 'visit_act', '')::uuid);
      delta := (hit ->> 'points')::integer;
      payload := payload || jsonb_build_object('infraction_act', hit ->> 'infraction');
    end if;
  else
    -- A ban: its length is its days; a reduction counts half of them from the ban's start, an increase runs half of them past its end.
    days := (pun.payload ->> 'days')::integer;
    if close_appeal.verdict = 'overturned' then new_until := now();
    elsif close_appeal.verdict = 'reduced' then new_until := pun.created_at + days * interval '12 hours';
    elsif close_appeal.verdict = 'increased' then new_until := (pun.payload ->> 'until')::timestamptz + days * interval '12 hours';
    end if;
    if new_until is not null then payload := payload || jsonb_build_object('until', new_until); end if;
  end if;

  key := 'appeal' || initcap(close_appeal.verdict);
  said := coalesce(nullif(said, ''), appeal_line(key, mod_key, appellant));
  payload := payload || jsonb_build_object('points_delta', delta, 'line', said);
  written := (write_staff_act(mod_key, 'appeal_ruling', ap.thread, ap.id, payload) ->> 'id')::uuid;

  -- An overturned appeal gets its price back.
  if close_appeal.verdict = 'overturned' then
    select w.account, -w.change as price into paid from wallet_events w where w.kind = 'appeal' and w.ref = ap.id;
    amount := coalesce(paid.price, 0);
    insert into appeal_refunds (appeal_act, amount, why) values (ap.id, amount, 'overturned');
    if amount > 0 then perform wallet_move(paid.account, amount, 'refund', null, ap.id); end if;
  end if;
  return jsonb_build_object('closed', true, 'ruling_act', written, 'verdict', close_appeal.verdict, 'staff', mod_key, 'line', said, 'points_delta', delta, 'refunded_amount', amount)
    || case when new_until is not null then jsonb_build_object('until', new_until) else '{}'::jsonb end
    || case when hit is not null then jsonb_build_object('infraction', hit ->> 'infraction', 'ban', hit -> 'ban') else '{}'::jsonb end;
end $$;
revoke execute on function close_appeal(uuid, text, text, text) from public, anon, authenticated;
grant execute on function close_appeal(uuid, text, text, text) to service_role;

-- ---------------------------------------------------------------------------------------------------- refund_appeal ----

create function refund_appeal(appeal_act uuid, why text default 'failed') returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  ap acts%rowtype;
  paid record;
  amount integer;
begin
  select * into ap from acts a where a.id = refund_appeal.appeal_act and a.kind = 'appeal';
  if not found then raise exception 'there is no such appeal' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
  perform pg_advisory_xact_lock(hashtextextended('kayfabb.appeal.' || ap.id::text, 0));
  if exists (select 1 from acts a where a.kind = 'appeal_ruling' and a.target_act_id = ap.id) then
    return jsonb_build_object('refunded', false, 'closed', true);
  end if;
  if exists (select 1 from appeal_refunds f where f.appeal_act = ap.id) then
    return jsonb_build_object('refunded', false, 'already', true);
  end if;
  select w.account, -w.change as price into paid from wallet_events w where w.kind = 'appeal' and w.ref = ap.id;
  amount := coalesce(paid.price, 0);
  insert into appeal_refunds (appeal_act, amount, why) values (ap.id, amount, coalesce(refund_appeal.why, 'failed'));
  if amount > 0 then perform wallet_move(paid.account, amount, 'refund', null, ap.id); end if;
  return jsonb_build_object('refunded', true, 'amount', amount);
end $$;
revoke execute on function refund_appeal(uuid, text) from public, anon, authenticated;
grant execute on function refund_appeal(uuid, text) to service_role;

-- Appeals whose judgment never came back (the function died between the payment and the answer, or a client called open_appeal and went no further): refunded, oldest first, at
-- most `most` at a time.
create function refund_stale_appeals(minutes integer default 10, most integer default 100) returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  stale uuid;
  n integer := 0;
begin
  for stale in
    select r.id from acts r
    where r.kind = 'appeal' and r.created_at < now() - make_interval(mins => greatest(refund_stale_appeals.minutes, 1))
      and r.created_at >= now() - interval '3 days'
      and not exists (select 1 from acts v where v.kind = 'appeal_ruling' and v.target_act_id = r.id)
      and not exists (select 1 from appeal_refunds f where f.appeal_act = r.id)
    order by r.created_at, r.id limit greatest(refund_stale_appeals.most, 0)
  loop
    if (refund_appeal(stale, 'stale') ->> 'refunded')::boolean then n := n + 1; end if;
  end loop;
  return n;
end $$;
revoke execute on function refund_stale_appeals(integer, integer) from public, anon, authenticated;
grant execute on function refund_stale_appeals(integer, integer) to service_role;
