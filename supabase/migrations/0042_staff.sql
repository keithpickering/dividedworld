-- Staff characters: a Boss or a Mod Bot is a character with no account behind it, publicly so. The system
-- plan, Task 4 (amended 2026-10-31); the seasonal Boss design, section 1; the staff design, "Staff
-- characters, like Bosses".
--
-- A staff character is an ordinary character in every way the forum can see: it has a name, a profile,
-- a post count and Acts in threads. What it lacks is a player. Its `owner` is null and its `staff` is a
-- key the instance's seed gave it; `staff_kind` says whether it is a Boss (the season names it, and the
-- seed makes it once) or a Mod Bot (who is on staff is read from `staff_changes`). It has no class, no
-- wallet and no standing, and earns nothing: a reaction to its Act is tallied for everyone to see and
-- pays nobody, the way a reaction to The System's own Acts does (0015).
--
-- Its Acts are written only by write_staff_act, which opens a transaction-local setting,
-- `kayfabb.staff_writer`, for the one insert; acts_well_formed refuses an Act naming a staff character
-- without it. No player writer reaches one anyway: every one asks played_by(character, caller), which
-- reads `owner = who`, and a null owner equals nothing, a null `who` included.
--
-- Every other reader of `characters.owner` was read for a null owner (listed in the build session's
-- report); the ones that needed a change are changed below, each with its reason: the cap, the
-- standings roster and its count, the season's reveal, and restoring a retired character.
--
-- Its way out: a staff character is never a trap for a player. A Mod Bot is hired and fired by rows of
-- staff_changes; a retired staff character is restored by an admin as any is.

alter table characters alter column owner drop not null;
alter table characters add column staff text unique;
alter table characters add column staff_kind text check (staff_kind in ('boss', 'bot'));
alter table characters add constraint characters_staff_has_no_owner check ((owner is null) = (staff is not null));
alter table characters add constraint characters_staff_has_a_kind check ((staff is null) = (staff_kind is null));

-- characters_within_cap (0021): a character with no owner holds no player's slot, and has no roster to lock.
create or replace function characters_within_cap() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare cap integer := (setting('charactersPerPlayer'))::integer;
declare held integer;
begin
  if new.owner is null then return new; end if;
  perform 1 from accounts where id = new.owner for no key update;
  select count(*) into held from characters where owner = new.owner and retired_at is null;
  if held >= cap then
    raise exception 'a player runs at most % characters', cap using hint = 'kayfabb.refusal', errcode = 'P0001';
  end if;
  return new;
end $$;

-- ------------------------------------------------------------------------- who is on staff ----

-- Who is hired and who is fired, one row for each, never changed: who is on staff is the latest row of
-- each bot. A row's `move_act` is the structural move that made it, once the Boss's hires and fires are
-- moves (the staff design, section 10); the seed's first staff have none. No client reaches it.
create table staff_changes (
  id bigint generated always as identity primary key,
  staff text not null references characters (staff),
  on_staff boolean not null,
  at timestamptz not null default now(),
  move_act uuid references acts (id)
);
create index staff_changes_latest on staff_changes (staff, id desc);
alter table staff_changes enable row level security;
revoke all on staff_changes from public, anon, authenticated;

create function staff_changes_append_only() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  raise exception 'a staff change is never edited or removed (%); write a new one', tg_op using errcode = 'P0001';
end $$;
create trigger staff_changes_no_update before update or delete on staff_changes for each row execute function staff_changes_append_only();
create trigger staff_changes_no_truncate before truncate on staff_changes for each statement execute function staff_changes_append_only();
-- Always: a session in replica mode, as a restore with triggers disabled runs, fires them too.
alter table staff_changes enable always trigger staff_changes_no_update;
alter table staff_changes enable always trigger staff_changes_no_truncate;

-- A Boss is never in staff_changes: the season names it.
create function staff_changes_only_bots() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if exists (select 1 from characters c where c.staff = new.staff and c.staff_kind is distinct from 'bot') then
    raise exception 'only a Mod Bot is hired or fired; the season names its Boss' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger staff_changes_only_bots before insert on staff_changes for each row execute function staff_changes_only_bots();
revoke execute on function staff_changes_append_only(), staff_changes_only_bots() from public, anon, authenticated;

-- The Mod Bots on staff now: each one's latest row, where it says on staff, and when that row was written.
-- Public, as a Boss's name is: the staff are known to be staff.
-- The partial index staff_now (and every staff lookup) reads: the staff are a handful of rows among all characters.
create index characters_staff on characters (staff) where staff is not null;
create view staff_now as
  select c.staff, c.staff_kind as kind, l.at as since
  from characters c
  cross join lateral (select s.on_staff, s.at from staff_changes s where s.staff = c.staff order by s.id desc limit 1) l
  where c.staff is not null and c.staff_kind = 'bot' and l.on_staff;
revoke all on staff_now from public, anon, authenticated;
grant select on staff_now to anon, authenticated;

-- my_posts_played_on (0037), with one comparison changed: a staff character has no owner, so `by_whom.owner <> auth.uid()`
-- is null for its card and the play dropped out of the post's author's log. `is distinct from` keeps it; a play through
-- the caller's own character is still left out. Everything else, and the grants, as 0037 wrote them.
create or replace view my_posts_played_on as
  select k.id as play, k.target_act_id as post, k.created_at as at, e.saved_at
  from acts k
  join acts p on p.id = k.target_act_id
  join characters c on c.id = p.character
  join characters by_whom on by_whom.id = k.character
  left join effect_state e on e.play = k.id
  where k.kind = 'card' and c.owner = auth.uid() and by_whom.owner is distinct from auth.uid();

revoke all on my_posts_played_on from anon, public;
grant select on my_posts_played_on to authenticated;

-- ---------------------------------------------------------------------- acts by staff ----

-- acts_well_formed (0027), with one refusal added: an Act naming a staff character is written only inside
-- write_staff_act, which opens `kayfabb.staff_writer` for the one insert. This holds a writer that forgets
-- (the player writers already cannot: played_by never matches a null owner). Everything else as 0027
-- wrote it.
create or replace function acts_well_formed() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare t acts%rowtype;
begin
  if new.character is not null and coalesce(current_setting('kayfabb.staff_writer', true), '') <> 'on'
     and exists (select 1 from characters c where c.id = new.character and c.staff is not null) then
    raise exception 'a staff character acts only through The System' using hint = 'kayfabb.refusal', errcode = '42501';
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

-- The one writer of a staff character's Acts, for The System's Edge Functions (the service role). A post,
-- a spin, a card or an edit: a staff character has no class to unmask, and a tally and a reveal are
-- no character's. The table's own rules still hold (an edit is of its own post, a card lands on a post).
-- The setting is transaction-local and closed again after the insert, so nothing else written in the
-- same transaction is let through. Returns the Act's public projection, for its caller to send live.
create function write_staff_act(staff_key text, kind text, thread uuid, target uuid, payload jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  who uuid;
  written uuid;
begin
  if kind is null or kind not in ('post', 'spin', 'card', 'edit') then
    raise exception 'a staff character posts, spins, plays a card or edits, not %', coalesce(kind, 'nothing') using errcode = '22023';
  end if;
  if jsonb_typeof(payload) is distinct from 'object' then raise exception 'an Act''s payload is an object' using errcode = '22023'; end if;
  select c.id into who from characters c where c.staff = staff_key;
  if who is null then raise exception 'there is no staff member "%"', staff_key using errcode = 'P0002'; end if;
  perform set_config('kayfabb.staff_writer', 'on', true);
  insert into acts (character, kind, thread, target_act_id, payload) values (who, kind, thread, target, payload) returning id into written;
  perform set_config('kayfabb.staff_writer', '', true);
  return act_projection(written);
end $$;
revoke execute on function write_staff_act(text, text, uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function write_staff_act(text, text, uuid, uuid, jsonb) to service_role;

-- ---------------------------------------------------------------------- what earns nothing ----

-- Whether an Act, given as its author, kind and target, is on the staff's side of the settlement: written by
-- a staff character, or a card played on a staff character's post. Neither is settled. A staff
-- character has no class, wallet or standing, so its Acts earn nothing; a card on its post has no
-- scored target (settle.ts reads a card's target from the Acts it is given, and the staff's are not
-- among them), so it is left out with it. Both are named in `systemActs`, where settle.ts drops a
-- reaction to them. A pk probe for each Act asked about.
create function is_staff_side(author uuid, kind text, target uuid) returns boolean
language sql stable set search_path = public, pg_temp as $$
  select exists (select 1 from characters c where c.id = author and c.staff is not null)
      or (kind = 'card' and exists (select 1 from acts t join characters c on c.id = t.character where t.id = target and c.staff is not null))
$$;
revoke execute on function is_staff_side(uuid, text, uuid) from public, anon, authenticated;

-- settlement_input (0004): staff characters' Acts, and cards on them, are left out of what earns and named
-- in `systemActs`, as The System's own Acts are. Everything else as 0004 wrote it.
create or replace function settlement_input(window_start timestamptz, window_end timestamptz) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  with
  -- The System's own Acts (the reveal) are no character's, and nobody's to settle; a staff character's
  -- are The System's too (0042): staff earn nothing, and a card on a staff Act is nobody's to score.
  win_acts as (select * from acts a where a.created_at >= window_start and a.created_at < window_end and a.character is not null
               and not is_staff_side(a.character, a.kind, a.target_act_id)),
  win_reactions as (select * from reactions r where r.created_at >= window_start and r.created_at < window_end),
  reacted as (select distinct act from win_reactions),
  earlier_reactions as (select r.* from reactions r join reacted x on x.act = r.act where r.created_at < window_start),
  active_spun as (select distinct t.id from threads t join win_acts a on a.thread = t.id where t.origin_act_id is not null),
  spins as (select a.* from acts a join active_spun t on t.id = a.thread where a.kind = 'spin'),
  first_posts as (
    -- Each character's first post in the thread, read through acts_thread_posts, one per
    -- character rather than a sort of the whole thread.
    select f.* from active_spun t
    cross join lateral (select distinct a.character from acts a where a.thread = t.id and a.kind = 'post' and a.created_at < window_end) w
    cross join lateral (select a.* from acts a where a.thread = t.id and a.character = w.character and a.kind = 'post' and a.created_at < window_end
                        order by a.created_at, a.id limit 1) f
  ),
  touched as (
    select id from win_acts union select act from reacted
    union select target_act_id from win_acts where kind in ('card', 'spin') and target_act_id is not null
    union select id from spins union select target_act_id from spins where target_act_id is not null
    -- Every card on an Act a reaction touches, an earlier window's too: a vote counts once per
    -- player and alignment, for the earliest card (engine/rules/settle.ts).
    union select a.id from acts a join reacted x on x.act = a.target_act_id where a.kind = 'card'
    union select id from first_posts
  ),
  all_acts as (select a.* from acts a join touched t on t.id = a.id where a.created_at < window_end and a.character is not null
               and not is_staff_side(a.character, a.kind, a.target_act_id)),
  -- Named, never settled: settle.ts drops a reaction to one, and reads a spin from one as from another.
  system_acts as (select a.id from acts a join touched t on t.id = a.id
                  where a.character is null or is_staff_side(a.character, a.kind, a.target_act_id)),
  all_reactions as (select * from win_reactions union all select * from earlier_reactions),
  named as (select character as id from all_acts union select reactor_character from all_reactions),
  ms as (select 1)
  select jsonb_build_object(
    'window', jsonb_build_object('id', to_jsonb(window_start) #>> '{}',
      'from', (extract(epoch from window_start) * 1000)::bigint, 'to', (extract(epoch from window_end) * 1000)::bigint),
    'characters', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'player', c.owner, 'classes', coalesce((
        select jsonb_agg(jsonb_build_object('class', h.class_key, 'from', (extract(epoch from h.started_at) * 1000)::bigint) order by h.started_at)
        from class_history h where h.character = c.id and h.started_at < window_end), '[]')) order by c.id)
      from characters c join named n on n.id = c.id), '[]'),
    'acts', coalesce((
      select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('id', a.id, 'character', a.character, 'kind', a.kind,
        'at', (extract(epoch from a.created_at) * 1000)::bigint, 'thread', a.thread, 'target', a.target_act_id,
        'card', case when a.kind = 'card' then a.payload ->> 'card' end)) order by a.created_at, a.id)
      from all_acts a), '[]'),
    'reactions', coalesce((
      select jsonb_agg(jsonb_build_object('act', r.act, 'kind', r.kind, 'at', (extract(epoch from r.created_at) * 1000)::bigint,
        'player', r.reactor_account, 'character', r.reactor_character) order by r.created_at, r.id)
      from all_reactions r), '[]'),
    -- The System's Acts an input Act points at (a spin from the reveal): named, never settled.
    'systemActs', coalesce((select jsonb_agg(id order by id) from system_acts), '[]'),
    -- What earlier windows paid for each vote this window's reactions touch.
    'paid', coalesce((
      select jsonb_agg(jsonb_build_object('player', p.account, 'act', p.act, 'weight', p.weight, 'shares', p.shares) order by p.account, p.act)
      from paid_votes p join (select distinct act, reactor_account from win_reactions) w on w.act = p.act and w.reactor_account = p.account), '[]'))
$$;

-- estimate_input (0017): the same, and a reaction to an Act left out is not handed to the caller either. Everything else as 0017 wrote it.
create or replace function estimate_input(account uuid, until timestamptz default now()) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  salt text := gen_random_uuid()::text;
  window_start timestamptz := coalesce((select max(ends_at) from settlements), (select min(starts_at) from seasons));
  season_end timestamptz;
  window_end timestamptz;
  you text := md5(salt || 'you');
begin
  -- The window the next settlement reads begins where next_settlement_window (0004) begins it: at
  -- the last settled end, or, where no season holds that instant (a gap between seasons), at the
  -- next season's start; and it never runs past its season's end.
  if window_start is not null and not exists (select 1 from seasons where starts_at <= window_start and (ends_at is null or ends_at > window_start)) then
    window_start := (select min(starts_at) from seasons where starts_at > window_start);
  end if;
  if window_start is null then return null; end if;
  select coalesce(s.ends_at, nullif(greatest(s.starts_at + span_interval(setting('seasonLength')), window_start), window_start)) into season_end
  from seasons s where s.starts_at <= window_start and (s.ends_at is null or s.ends_at > window_start);
  window_end := least(until, coalesce(season_end, 'infinity'));
  if window_start >= window_end then return null; end if;
  return (
  with
  mine as (select id from characters where owner = account),
  win_acts as (select a.* from acts a join mine m on m.id = a.character where a.created_at >= window_start and a.created_at < window_end),
  -- The caller's Acts reacted to in the window, whenever written: each of the caller's Acts, then
  -- its reactions through the index that leads with the Act, never the whole window's reactions.
  mine_reacted as (select distinct a.id as act from acts a join mine m on m.id = a.character
                   where exists (select 1 from reactions r where r.act = a.id and r.created_at >= window_start and r.created_at < window_end)),
  -- The Acts the caller reacted to in the window, through reactions_reactor.
  reacted_by_me as (select distinct r.act from reactions r where r.reactor_account = account and r.created_at >= window_start and r.created_at < window_end),
  targets as (select target_act_id as id from win_acts where kind in ('card', 'spin') and target_act_id is not null),
  -- Every card of the caller's on a post the caller's window cards point at: a vote counts for the earliest.
  my_cards_there as (select a.id from acts a join mine m on m.id = a.character join targets t on t.id = a.target_act_id where a.kind = 'card' and a.created_at < window_end),
  -- Cards others played on the caller's posts in the window.
  landed as (select a.id from acts p join mine m on m.id = p.character join acts a on a.target_act_id = p.id
             where a.kind = 'card' and a.created_at >= window_start and a.created_at < window_end),
  -- The caller's spun threads active in the window: the spin, and each character's first post.
  spun as (select distinct s.thread as id from acts s join mine m on m.id = s.character
           where s.kind = 'spin' and exists (select 1 from acts x where x.thread = s.thread and x.created_at >= window_start and x.created_at < window_end)),
  spins as (select a.id from acts a join spun t on t.id = a.thread where a.kind = 'spin'),
  first_posts as (
    select f.id from spun t
    cross join lateral (select distinct a.character from acts a where a.thread = t.id and a.kind = 'post' and a.created_at < window_end) w
    cross join lateral (select a.id from acts a where a.thread = t.id and a.character = w.character and a.kind = 'post' and a.created_at < window_end
                        order by a.created_at, a.id limit 1) f
  ),
  -- The Acts whose reactions are read.
  voted as (select id from win_acts union select act from mine_reacted union select act from reacted_by_me union select id from targets),
  touched as (
    select id from voted union select id from my_cards_there union select id from landed union select id from spins
    union select target_act_id from acts a join spins s on s.id = a.id where a.target_act_id is not null
    union select id from first_posts
  ),
  -- As settlement_input (0004, as 0042 changed it): a staff character's Acts, and a card on one, are named and pay nobody.
  all_acts as (select a.* from acts a join touched t on t.id = a.id where a.created_at < window_end and a.character is not null
               and not is_staff_side(a.character, a.kind, a.target_act_id)),
  system_acts as (select a.id from acts a join touched t on t.id = a.id
                  where a.character is null or is_staff_side(a.character, a.kind, a.target_act_id)),
  -- Every reaction on an Act voted on, up to now, but a player's to their own character's, and none
  -- on The System's own Acts: the settlement pays nobody for those (Task 3), and the tally every
  -- player reacts to would hand each caller who reacted to it every other player's reaction.
  all_reactions as (
    select r.* from reactions r join voted v on v.id = r.act
    join acts a on a.id = r.act join characters c on c.id = a.character
    where r.created_at < window_end and r.reactor_account <> c.owner
      and not is_staff_side(a.character, a.kind, a.target_act_id)
  ),
  -- Each reaction's voter and mask as the engine reads them: the caller's own, as the caller's;
  -- any other's, under keys made up for this request.
  keyed as (
    select r.id, r.act, r.kind, r.created_at,
      case when r.reactor_account = account then you else md5(salt || 'reactor' || r.reactor_character) end as player,
      case when r.reactor_account = account then r.reactor_character::text else md5(salt || 'mask' || r.reactor_character) end as character
    from all_reactions r
  ),
  others as (
    select distinct a.character::text as id, md5(salt || 'author' || a.character) as player from all_acts a where a.character not in (select id from mine)
    union select distinct k.character, k.player from keyed k where k.player <> you
  )
  select jsonb_build_object(
    'player', you,
    -- The window's start exactly, as the settlement that opened it ended: `from` is whole
    -- milliseconds, which can fall short of it. The estimate keeps its answer with this one.
    'windowStart', window_start,
    'window', jsonb_build_object('id', 'estimate',
      'from', (extract(epoch from window_start) * 1000)::bigint, 'to', (extract(epoch from window_end) * 1000)::bigint),
    'characters', coalesce((
      select jsonb_agg(x order by x ->> 'id') from (
        select jsonb_build_object('id', c.id, 'player', you, 'classes', coalesce((
          select jsonb_agg(jsonb_build_object('class', h.class_key, 'from', (extract(epoch from h.started_at) * 1000)::bigint) order by h.started_at)
          from class_history h where h.character = c.id and h.started_at < window_end), '[]')) as x
        from characters c join mine m on m.id = c.id
        union all
        select jsonb_build_object('id', o.id, 'player', o.player, 'classes', '[]'::jsonb) from others o
      ) cs), '[]'),
    'acts', coalesce((
      select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('id', a.id, 'character', a.character, 'kind', a.kind,
        'at', (extract(epoch from a.created_at) * 1000)::bigint, 'thread', a.thread, 'target', a.target_act_id,
        'card', case when a.kind = 'card' then a.payload ->> 'card' end)) order by a.created_at, a.id)
      from all_acts a), '[]'),
    'reactions', coalesce((
      select jsonb_agg(jsonb_build_object('act', k.act, 'kind', k.kind, 'at', (extract(epoch from k.created_at) * 1000)::bigint,
        'player', k.player, 'character', k.character) order by k.created_at, k.id)
      from keyed k), '[]'),
    'systemActs', coalesce((select jsonb_agg(id order by id) from system_acts), '[]'))
  );
end $$;

-- characters_public (0030) gains the staff key and kind: the Director is known to be the Director, and a
-- player's character shows neither.
create or replace view characters_public as
  select c.id, c.name, date_trunc('month', c.debuted_at at time zone 'UTC')::date as joined, c.staff, c.staff_kind
  from characters c where c.debuted_at is not null;

-- ------------------------------------------------------- no standing, no count, no reveal ----

-- The debuted count (0030), the standings roster (0030) and the season's reveal (0029) are the characters
-- being scored; a staff character has no standing, so none of them holds it. The pager's count and
-- the list it counts stay one list. Everything else as 0030 wrote them.
create or replace function characters_count_debuted() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  change integer := case when tg_op = 'DELETE' then 0 else (new.debuted_at is not null and new.staff is null)::integer end
                  - case when tg_op = 'INSERT' then 0 else (old.debuted_at is not null and old.staff is null)::integer end;
  taken integer;
begin
  if change <> 0 then
    -- A shard no other transaction holds; else the first one not made yet (up to four); else wait for the first.
    taken := coalesce((select d.shard from debuted_count d order by d.shard for update skip locked limit 1),
                      (select g from generate_series(0, 3) g where not exists (select 1 from debuted_count d where d.shard = g) limit 1), 0);
    insert into debuted_count as d (shard, characters) values (taken, change) on conflict (shard) do update set characters = d.characters + change;
  end if;
  return null;
end $$;

create or replace function backfill_debuted_count() returns void
language sql set search_path = public, pg_temp as $$
  update debuted_count set characters = 0;
  -- No row for no characters: a fresh instance's tables are empty until something is written (see above).
  insert into debuted_count as d (shard, characters) select 0, count(*) from characters where debuted_at is not null and staff is null having count(*) > 0
  on conflict (shard) do update set characters = excluded.characters
$$;

create or replace function characters_join_standings() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.debuted_at is not null and new.staff is null and (tg_op = 'INSERT' or old.debuted_at is null) then
    perform standings_roster_lock(false);
    -- A statement of its own after the lock, so it reads the season a season that committed meanwhile opened.
    insert into standings (character, season, amount) select new.id, standings_season(), 0 where standings_season() is not null
    on conflict (season, character) do nothing;
  end if;
  return null;
end $$;

create or replace function seasons_open_standings() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform standings_roster_lock(true);
  insert into standings (character, season, amount) select c.id, new.id, 0 from characters c where c.debuted_at is not null and c.staff is null
  on conflict (season, character) do nothing;
  return null;
end $$;

create or replace function backfill_standings_roster() returns void
language sql set search_path = public, pg_temp as $$
  insert into standings (character, season, amount) select c.id, standings_season(), 0 from characters c
  where c.debuted_at is not null and c.staff is null and standings_season() is not null
  on conflict (season, character) do nothing
$$;

-- reveal_season (0029): no line for a staff character, and none counted in the reveal's own. Everything else as 0029 wrote it.
create or replace function reveal_season(ended timestamptz) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  s seasons%rowtype;
  in_thread uuid;
  written uuid;
begin
  select * into s from seasons where ends_at is null for no key update;
  if s.id is null or s.starts_at + span_interval(setting('seasonLength')) > ended then return null; end if;

  update seasons set ends_at = ended where id = s.id;
  insert into seasons (number, starts_at) values (s.number + 1, ended);
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

-- restore_character (0021): a staff character has no owner, so no roster to fill and no cap to meet. The
-- messages are 0021's. A retired staff character is restored as any is, by an admin: its way out.
create or replace function restore_character(of_character uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  its_owner uuid;
  cap integer := (setting('charactersPerPlayer'))::integer;
begin
  perform only_admins('restores a character');
  perform 1 from characters where id = of_character and retired_at is not null;
  if not found then
    if exists (select 1 from characters where id = of_character) then raise exception 'that character is not retired' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
    raise exception 'there is no such character' using hint = 'kayfabb.refusal', errcode = 'P0002';
  end if;
  select owner into its_owner from characters where id = of_character;
  if its_owner is not null then
    -- The roster's lock, as a creation takes it (characters_within_cap): a restore and a creation at
    -- once count one after the other, so they never fill a roster past its cap together.
    perform 1 from accounts where id = its_owner for no key update;
    if (select count(*) from characters where owner = its_owner and retired_at is null) >= cap then
      raise exception 'its player already runs % characters; one retired frees a slot', cap using hint = 'kayfabb.refusal', errcode = 'P0001';
    end if;
  end if;
  update characters set retired_at = null where id = of_character;
  return jsonb_build_object('character', of_character, 'retired', false);
end $$;

-- ------------------------------------------------------------------------ the season's Boss ----

-- The Boss of a season is a staff character, named by its key; nullable only for a season opened before this
-- migration (and the seasons the seed opens before a Boss is chosen for them).
alter table seasons add column boss text references characters (staff);

create function current_boss() returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select boss from seasons where ends_at is null
$$;
revoke execute on function current_boss() from public, anon, authenticated;
grant execute on function current_boss() to service_role;

-- seed_instance (0039), seeding the instance's staff: `system.staff` (each {key, name, title, signature, kind}) and
-- `system.firstStaff` (the keys of the bots on staff at first). A seed without `system` seeds none. A
-- staff member is made once, when its key has no character, so a reseed writes over nothing an admin wrote;
-- a character's profile is made with it, and a profile's title and signature are cut to the 40 and 500
-- characters it holds. Everything else as 0039 wrote it.
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
  if not exists (select 1 from seasons) then insert into seasons (number, starts_at) values (1, now()); end if;
  return jsonb_build_object('settings', (select count(*) from settings), 'classes', (select count(*) from class_kinds),
    'reactions', (select count(*) from reaction_kinds), 'cards', (select count(*) from card_kinds), 'boards', (select count(*) from boards));
end $$;
