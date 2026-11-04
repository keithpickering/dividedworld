-- Offices and the office log (the staff roster design, section 2; its plan, Task 2).
--
-- Every staff persona is one kind of character, `persona` (the developer, Gabe, stays its own). What a persona holds is an office:
--   boss     the season's Boss, computed from the open season (`current_boss()`) and never written down, so who is Boss has one source;
--   mod      a Mod Bot, on staff;
--   member   off staff, posting;
--   benched  silent: off staff and out of the pool, still a character with its profile and history;
--   waiting  never held an office, so not debuted: no posts, no presence, no place on Rankings (`debuted_at` is null).
-- Every office but the Boss's and waiting is the latest row of `staff_offices`, an append-only log naming what caused each change
-- (the seed, a handover, a move, an admin). It replaces `staff_changes`, whose rows are copied in first.
--
-- Ways out of the states this adds: waiting ends when the persona is named Boss (the handover debuts it), hired or debuted by an
-- admin (`set_office`); benched ends by an admin's `set_office` or a later Boss's hire (a move); a member by a hire, a nomination or an
-- admin. The last Mod Bot cannot be benched or fired by an admin, so the staff is never empty.

-- ---------------------------------------------------------------------------------------------- one kind of persona ----

alter table characters drop constraint characters_staff_kind_check;
update characters set staff_kind = 'persona' where staff_kind in ('boss', 'bot');
alter table characters add constraint characters_staff_kind_check check (staff_kind in ('persona', 'developer'));

-- ------------------------------------------------------------------------------------------------- the office log ----

create table staff_offices (
  id bigint generated always as identity primary key,
  staff text not null references characters (staff),
  office text not null check (office in ('mod', 'member', 'benched')),
  cause text not null check (cause in ('seed', 'handover', 'move', 'admin')),
  season bigint references seasons (id),
  move_act uuid references acts (id),
  admin uuid references accounts (id),
  at timestamptz not null default now()
);
create index staff_offices_latest on staff_offices (staff, id desc);
alter table staff_offices enable row level security;
revoke all on staff_offices from public, anon, authenticated;

create function staff_offices_append_only() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  raise exception 'an office change is never edited or removed (%); write a new one', tg_op using errcode = 'P0001';
end $$;
create trigger staff_offices_no_update before update or delete on staff_offices for each row execute function staff_offices_append_only();
create trigger staff_offices_no_truncate before truncate on staff_offices for each statement execute function staff_offices_append_only();
-- Always: a session in replica mode, as a restore with triggers disabled runs, fires them too.
alter table staff_offices enable always trigger staff_offices_no_update;
alter table staff_offices enable always trigger staff_offices_no_truncate;

-- The developer holds no office: only an admin writes as it, and no road from the roster a model works through leads to it.
create function staff_offices_only_personas() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if exists (select 1 from characters c where c.staff = new.staff and c.staff_kind is distinct from 'persona') then
    raise exception 'only a persona holds an office; the developer holds none' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger staff_offices_only_personas before insert on staff_offices for each row execute function staff_offices_only_personas();
revoke execute on function staff_offices_append_only(), staff_offices_only_personas() from public, anon, authenticated;

-- Every row of staff_changes, in order, move_act included: on staff becomes mod (cause move where a structural move made it, else the
-- seed), off staff becomes member. Then the old table and its guard go: the office log is the one list of who holds what.
insert into staff_offices (staff, office, cause, move_act, at)
select s.staff, case when s.on_staff then 'mod' else 'member' end, case when s.move_act is null then 'seed' else 'move' end, s.move_act, s.at
from staff_changes s order by s.id;
drop view staff_now;
drop table staff_changes;
drop function staff_changes_append_only(), staff_changes_only_bots();

-- ------------------------------------------------------------------------------------------- the current office ----

-- Each persona's office now: the Boss where the open season names it; waiting where it has not debuted; else its latest row, or member
-- where it has none. `since` is when the office began (the season's start for the Boss; null for a persona still waiting). Public, as
-- the staff are known to be staff. The developer is not a persona and has no row here.
-- (The open season's Boss is read from `seasons` here and not through current_boss(): a function's execute privilege is the caller's,
-- and the callers of this view are visitors and players.)
create view staff_office_now as
  select c.staff,
    case when c.staff = b.boss then 'boss' when c.debuted_at is null then 'waiting' else coalesce(l.office, 'member') end as office,
    case when c.staff = b.boss then b.starts_at when c.debuted_at is null then null else coalesce(l.at, c.debuted_at) end as since
  from characters c
  left join lateral (select s.boss, s.starts_at from seasons s where s.ends_at is null) b on true
  left join lateral (select o.office, o.at from staff_offices o where o.staff = c.staff order by o.id desc limit 1) l on true
  where c.staff is not null and c.staff_kind = 'persona';
revoke all on staff_office_now from public, anon, authenticated;
grant select on staff_office_now to anon, authenticated;

-- staff_now (0043), its columns kept: the Mod Bots on staff now.
create view staff_now as
  select o.staff, 'persona'::text as kind, o.since from staff_office_now o where o.office = 'mod';
revoke all on staff_now from public, anon, authenticated;
grant select on staff_now to anon, authenticated;

-- characters_public (0043) shows the office in place of the kind: null for a player's character, `developer` for the developer.
-- The column is renamed and the view replaced in place, so the policies and views that read it (thread_open, thread_list) and its
-- grants stay as they are.
alter view characters_public rename column staff_kind to office;
create or replace view characters_public as
  select c.id, c.name, date_trunc('month', c.debuted_at at time zone 'UTC')::date as joined, c.staff,
    case when c.staff is null then null when c.staff_kind = 'developer' then 'developer' else o.office end as office
  from characters c left join staff_office_now o on o.staff = c.staff
  where c.debuted_at is not null;

-- ---------------------------------------------------------------------------------------------- the roster ----

-- The roster in order (0051): the seed's order (`bossRoster`) first, then any other by key. Every unretired persona whose office is not
-- benched is a candidate for the Boss's seat, a waiting one included: the Boss may come from any office.
create or replace function boss_roster() returns text[]
language sql stable security definer set search_path = public, pg_temp as $$
  with listed as (
    select r.key, r.ord from jsonb_array_elements_text(coalesce((select s.value from settings s where s.key = 'bossRoster' and jsonb_typeof(s.value) = 'array'), '[]'::jsonb)) with ordinality r(key, ord)
  ), personas as (
    select c.staff, coalesce(l.ord, 1000000) as ord from characters c
    join staff_office_now o on o.staff = c.staff left join listed l on l.key = c.staff
    where c.retired_at is null and o.office <> 'benched'
  )
  select coalesce(array_agg(p.staff order by p.ord, p.staff), '{}') from personas p
$$;

-- The roster with names and offices, for an admin's Boss list (the queue's replace choices and a nomination's name in a sentence). A
-- waiting persona is on the roster but has not debuted, so its name is in no public view; this is the one read of it, admins only.
create function boss_roster_names() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform only_admins('reads the Boss list');
  return (select coalesce(jsonb_agg(jsonb_build_object('staff', c.staff, 'name', c.name, 'office', o.office) order by r.ord), '[]'::jsonb)
          from unnest(boss_roster()) with ordinality r(staff, ord)
          join characters c on c.staff = r.staff join staff_office_now o on o.staff = r.staff);
end $$;
revoke execute on function boss_roster_names() from public, anon;
grant execute on function boss_roster_names() to authenticated;

-- queued_moves_guard (0051), a nomination naming any persona; replace_successor (0051) likewise. Everything else as 0051 wrote them.
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

create or replace function replace_successor(id bigint, boss text) returns jsonb
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
  if boss is null or not (boss = any (boss_roster())) then
    raise exception 'a successor is a persona on the Boss roster, and that one is benched, retired or no persona' using hint = 'kayfabb.refusal', errcode = '22023';
  end if;
  if boss = q.staff then raise exception 'a Boss cannot succeed itself' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  if boss = q.params ->> 'boss' then raise exception 'that Boss is already the one named' using hint = 'kayfabb.refusal', errcode = '55000'; end if;
  update queued_moves set params = params || jsonb_build_object('boss', replace_successor.boss), replaced_by = auth.uid(), replaced_at = now()
  where queued_moves.id = replace_successor.id;
  return jsonb_build_object('id', q.id, 'boss', boss);
end $$;

-- meeting_context (0051), also carrying `successors`: the keys a nomination may name, in the roster's order, so the meeting offers and
-- repairs against the database's own list (boss_roster, which queued_moves_guard also reads) and never recomputes it. Everything else as
-- 0051 wrote it.
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
    'successors', to_jsonb(array(select r from unnest(boss_roster()) with ordinality x(r, ord) where r is distinct from current_boss() order by x.ord)),
    'inheritanceDue', coalesce((select jsonb_agg(jsonb_build_object('act', d.act, 'kind', d.payload ->> 'kind', 'params', d.payload -> 'params',
        'landedAt', d.landed_at, 'expiresAt', d.payload -> 'expires_at', 'by', d.author, 'boardName', d.board_name) order by d.landed_at, d.act)
      from inheritance_due(current_boss(), 20) d), '[]'))
$$;

-- ------------------------------------------------------------------------------------------------- the handover ----

-- hand_over (0051), moving the offices inside its transaction (see the block). Everything else as 0051 wrote it.
create or replace function hand_over(new_season bigint, outgoing text, at timestamptz) returns jsonb
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
    -- The offices (0080): the arriving Boss debuts if it was waiting; the outgoing Boss becomes a member, or a Mod Bot where no persona
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
    perform say_in_announcements(outgoing, 'bossFarewell');
    perform say_in_announcements(chosen, 'bossArrival');
  end if;
  insert into season_handovers (season, outgoing, boss, how, note, at) values (new_season, outgoing, chosen, how, left(note, 1000), at);
  return jsonb_build_object('boss', chosen, 'how', how, 'note', note);
end $$;

-- --------------------------------------------------------------------------------------------------- an admin's word ----

-- An admin moves a persona between member, benched and mod. The Boss's office is the season's, so it is never moved here; a persona
-- that is waiting is debuted by the first office it takes (member, or mod); the last Mod Bot is never benched or fired, so the staff is
-- never empty. Each refusal names its predicate.
create function set_office(staff text, office text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  who characters%rowtype;
  held text;
begin
  perform only_admins('moves a persona between offices');
  if set_office.office is null or set_office.office not in ('mod', 'member', 'benched') then
    raise exception 'an office is mod, member or benched, not %; the season names its Boss', coalesce(set_office.office, 'nothing') using hint = 'kayfabb.refusal', errcode = '22023';
  end if;
  -- One at a time with a handover and with another admin, so the last-mod check reads what stands.
  perform pg_advisory_xact_lock(hashtext('kayfabb.offices'));
  select * into who from characters c where c.staff = set_office.staff and c.staff_kind = 'persona' for no key update;
  if not found then raise exception 'there is no such persona' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
  select o.office into held from staff_office_now o where o.staff = set_office.staff;
  if held = 'boss' then
    raise exception 'the season''s Boss holds the Boss''s office, which changes at the handover' using hint = 'kayfabb.refusal', errcode = '55000';
  end if;
  if held = set_office.office then raise exception 'that persona is already %', held using hint = 'kayfabb.refusal', errcode = '55000'; end if;
  if held = 'waiting' and set_office.office = 'benched' then
    raise exception 'a waiting persona has not debuted; make it a member or hire it first' using hint = 'kayfabb.refusal', errcode = '55000';
  end if;
  if held = 'mod' and not exists (select 1 from staff_office_now o join characters c on c.staff = o.staff
                                   where o.office = 'mod' and o.staff <> set_office.staff and c.retired_at is null) then
    raise exception 'that is the last Mod Bot, and the staff is never empty' using hint = 'kayfabb.refusal', errcode = '55000';
  end if;
  if held = 'waiting' then update characters c set debuted_at = now() where c.id = who.id; end if;
  insert into staff_offices (staff, office, cause, admin) values (set_office.staff, set_office.office, 'admin', auth.uid());
  return jsonb_build_object('staff', set_office.staff, 'office', set_office.office);
end $$;
revoke execute on function set_office(text, text) from public, anon;
grant execute on function set_office(text, text) to authenticated;

-- ---------------------------------------------------------------------------------------------------- a staff Act ----

-- write_staff_act (0062), refusing a persona that is waiting or benched. Everything else as 0062 wrote it.
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
  if kind is null or kind not in ('post', 'spin', 'card', 'edit', 'move', 'move_keep') then
    raise exception 'a staff character posts, spins, plays a card, edits, moves or keeps a move, not %', coalesce(kind, 'nothing') using errcode = '22023';
  end if;
  if jsonb_typeof(payload) is distinct from 'object' then raise exception 'an Act''s payload is an object' using errcode = '22023'; end if;
  if who is null then raise exception 'there is no staff member "%"', staff_key using errcode = 'P0002'; end if;
  -- A persona that has not debuted writes nothing, and a benched one is silent (0080).
  select o.office into held from staff_office_now o where o.staff = staff_key;
  if held in ('waiting', 'benched') then
    raise exception 'a % persona writes nothing', held using errcode = '55000';
  end if;
  perform set_config('kayfabb.staff_writer', 'on', true);
  insert into acts (character, kind, thread, target_act_id, payload) values (who, kind, thread, target, payload) returning id into written;
  perform set_config('kayfabb.staff_writer', '', true);
  return act_projection(written);
end $$;

-- ---------------------------------------------------------------------------------------------------- the seed ----

-- seed_instance (0062), reading the roster as one list of personas and writing the office log in place of staff_changes. Everything
-- else as 0062 wrote it.
create or replace function seed_instance(payload jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  flags integer;
  flagged text;
  unknown text;
  sys uuid;
  opened uuid;
begin
  -- Two seeds at once would each find no office row and both write one into the append-only office log. An advisory
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
  -- A card's play, rarity, trap, ward and time up (0054), and its reaches (0055), checked as instanceProblems checks them, each
  -- naming the card. The reaches are read against reachRarity and reachLasts as the settings above have just written them.
  select nullif(concat_ws('; ', card_kinds_problem(payload -> 'cards'), card_reach_problem(payload -> 'cards')), '') into unknown;
  if unknown is not null then raise exception '%', unknown using errcode = '22023'; end if;
  -- A card's stack, whether it is seeded and the economy numbers its rules read are the code's, as its name and price are; so
  -- are its rarity, its play, its trap, whether it is a ward, how long a Use of it is up, where it reaches and whether it pins.
  insert into card_kinds (key, name, alignment, price_setting, stack, seeded, reads, rarity, play, trap, ward, lasts, reaches, pins)
  select e ->> 'key', e ->> 'name', e ->> 'alignment', e ->> 'priceSetting', coalesce((e ->> 'stack')::integer, 1), coalesce((e ->> 'seeded')::boolean, false),
    coalesce(array(select jsonb_array_elements_text(e -> 'reads')), '{}'),
    e ->> 'rarity', coalesce(e ->> 'play', 'cast'), e -> 'trap', coalesce((e ->> 'ward')::boolean, false), span_interval(e -> 'lasts'),
    case when e ? 'reaches' then array(select jsonb_array_elements_text(e -> 'reaches')) else '{post}' end, coalesce((e ->> 'pins')::boolean, false)
  from jsonb_array_elements(payload -> 'cards') e
  on conflict (key) do update set name = excluded.name, alignment = excluded.alignment, price_setting = excluded.price_setting,
    stack = excluded.stack, seeded = excluded.seeded, reads = excluded.reads,
    rarity = excluded.rarity, play = excluded.play, trap = excluded.trap, ward = excluded.ward, lasts = excluded.lasts,
    reaches = excluded.reaches, pins = excluded.pins;
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
  -- The instance's personas (0080), once each: a persona is made when its key has no character yet, with the profile its seed gives (its
  -- title and its signature, cut to what a profile holds). The first Boss and the first staff debut at seed time; every other persona
  -- is made waiting, with no debut, and debuts the moment it first takes an office. What an admin wrote is never written over: a reseed
  -- finds the key and does nothing. A persona in firstStaff with no office row is hired as a Mod Bot, cause `seed`; one with a row,
  -- a benched one's included, is left as that row says, so a reseed never rehires.
  with seeded as (
    select e ->> 'key' as staff, e ->> 'name' as name, coalesce(e ->> 'title', '') as title, coalesce(e ->> 'signature', '') as signature
    from jsonb_array_elements(coalesce(payload -> 'system' -> 'staff', '[]')) e
  ), made as (
    insert into characters (name, staff, staff_kind, debuted_at)
    select s.name, s.staff, 'persona',
      case when s.staff = nullif(payload -> 'system' ->> 'firstBoss', '')
             or s.staff in (select jsonb_array_elements_text(coalesce(payload -> 'system' -> 'firstStaff', '[]'))) then now() end
    from seeded s
    on conflict (staff) do nothing returning id, staff
  )
  insert into character_profiles (character, title, signature)
  select m.id, left(s.title, 40), left(s.signature, 500) from made m join seeded s on s.staff = m.staff;
  select string_agg(k, ', ') into unknown from jsonb_array_elements_text(coalesce(payload -> 'system' -> 'firstStaff', '[]')) k
  where not exists (select 1 from characters c where c.staff = k and c.staff_kind = 'persona');
  if unknown is not null then raise exception 'firstStaff names %, which no persona in the seed''s roster is', unknown using errcode = '22023'; end if;
  insert into staff_offices (staff, office, cause)
  select k, 'mod', 'seed' from jsonb_array_elements_text(coalesce(payload -> 'system' -> 'firstStaff', '[]')) k
  where not exists (select 1 from staff_offices x where x.staff = k);
  -- A persona the seed seats as a mod is debuted: a reseed that adds a still-waiting persona to firstStaff hires it above, and it debuts here.
  update characters c set debuted_at = now()
  where c.debuted_at is null and c.staff_kind = 'persona'
    and c.staff in (select k from jsonb_array_elements_text(coalesce(payload -> 'system' -> 'firstStaff', '[]')) k)
    and exists (select 1 from staff_offices x where x.staff = c.staff and x.cause = 'seed' and x.office = 'mod');
  -- The name of the member group every persona is in, which the instance gives.
  insert into settings (key, value)
  select 'staffGroup', payload -> 'system' -> 'staffGroup' where jsonb_typeof(payload -> 'system' -> 'staffGroup') = 'object'
  on conflict (key) do update set value = excluded.value;
  -- The catalogs (0046): the moves and demands the engine holds, as the engine lists them. A reseed upserts a move's flag and
  -- never removes a kind, since a landed move may name it. A missing flag is a seed's mistake (a move that reshapes a board
  -- must not be seeded as one that does not), so it is refused by the column.
  insert into move_kinds (key, structural, shapes_board) select e ->> 'key', (e ->> 'structural')::boolean, coalesce((e ->> 'shapesBoard')::boolean, false) from jsonb_array_elements(coalesce(payload -> 'system' -> 'moves', '[]')) e
  on conflict (key) do update set structural = excluded.structural, shapes_board = excluded.shapes_board;
  insert into demand_kinds (key) select e ->> 'key' from jsonb_array_elements(coalesce(payload -> 'system' -> 'demands', '[]')) e
  on conflict (key) do nothing;
  -- The roster's order (0051): the seed's personas, in the order it lists them, so the rotation has one to follow. A seed with no
  -- persona leaves the setting as it was.
  insert into settings (key, value)
  select 'bossRoster', jsonb_agg(e.value ->> 'key' order by e.ord)
  from jsonb_array_elements(coalesce(payload -> 'system' -> 'staff', '[]')) with ordinality e(value, ord)
  having count(*) > 0
  on conflict (key) do update set value = excluded.value;
  if not exists (select 1 from seasons) then insert into seasons (number, starts_at) values (1, now()); end if;
  -- The open season's Boss (0043's seasons.boss) is the seed's firstBoss when it has none: a season opened before a Boss
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
  -- The developer persona and its thread (0062): a seed with a `developer` entry ({ name, title, avatar }) makes the one developer, once,
  -- as it makes a persona: debuted at seed time, with the tagline as its profile title, cut to what a profile holds. What an admin wrote is
  -- never written over: a reseed finds the key and does nothing, except that the avatar's asset key is the instance's to change. Then
  -- the updates thread, on The System's board, recorded in the setting `updatesThread` (not in a seed's `settings`, so no seed
  -- writes it over); the board's thread counter is netted by the thread's own, since a board's count is the length of its list and
  -- thread_list never lists this one.
  if jsonb_typeof(payload -> 'developer') = 'object' then
    -- The thread opens on The System's board, so a database with no board is told so before anything is made.
    if system_board() is null then raise exception 'a developer needs The System''s board; seed boards first' using errcode = '22023'; end if;
    with made as (
      insert into characters (name, staff, staff_kind, debuted_at) values (payload -> 'developer' ->> 'name', 'developer', 'developer', now())
      on conflict (staff) do nothing returning id
    )
    insert into character_profiles (character, title, signature)
    select m.id, left(coalesce(payload -> 'developer' ->> 'title', ''), 40), '' from made m;
    if nullif(payload -> 'developer' ->> 'avatar', '') is not null then
      insert into settings (key, value) values ('developerAvatar', to_jsonb(payload -> 'developer' ->> 'avatar'))
      on conflict (key) do update set value = excluded.value;
    end if;
    if not exists (select 1 from settings s join threads t on t.id::text = s.value #>> '{}' where s.key = 'updatesThread') then
      sys := system_board();
      insert into threads (board, title) values (sys, 'Updates') returning id into opened;
      insert into settings (key, value) values ('updatesThread', to_jsonb(opened::text)) on conflict (key) do update set value = excluded.value;
      update board_thread_counts set threads = threads - 1
       where board = sys and shard = coalesce((select c.shard from board_thread_counts c where c.board = sys order by c.shard for update skip locked limit 1), 0);
    end if;
  end if;
  return jsonb_build_object('settings', (select count(*) from settings), 'classes', (select count(*) from class_kinds),
    'reactions', (select count(*) from reaction_kinds), 'cards', (select count(*) from card_kinds), 'boards', (select count(*) from boards));
end $$;
