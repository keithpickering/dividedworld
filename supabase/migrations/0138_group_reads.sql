-- The group and bar reads use the move index (final review B1; CLAUDE.md "Weigh a design at the scale of a busy instance").
--
-- `acts_group_moves` (0129) is a partial index on (payload #>> '{params,character}', created_at desc) where kind = 'move' and payload ->> 'kind' = 'conferGroup'. A query
-- can use it only when its own WHERE implies the index's, so it must say `a.kind = 'move'` and compare the character as text, the index's own expression. group_now (0128)
-- and bars_now (0129) did neither, so every group read, and every bar read (`barred`, `not_barred` twice per post, new thread, spin and edit, and my_characters.bars),
-- scanned all the moves in force: cost that grows with the moves in force and not with the one character asked about.
--
--   group_now(character)    the open-move probe filters on the index's predicate and expression and reaches open_moves by its primary key. Everything else as 0128 wrote it.
--   bars_now                gains `a.kind = 'move'`, so a read of every bar starts from the index's rows. Its columns are as 0129 wrote them.
--   bars_of(character)      the bars of one character: bars_now's rows for it, found through acts_group_moves by comparing the character as text (the view's uuid cast
--                           would defeat the index). barred, not_barred and my_characters.bars read it.
--
-- Masks. Nothing here reads more than the move's Act already shows; the answers are the ones 0128, 0129, 0130 and 0133 gave.
-- Ways out. Read-only; it adds no state. Append-only. No Act is touched.

create or replace function group_now(in_character uuid) returns text
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  r record;
  posts integer;
  holds boolean;
  open_group text;
begin
  -- A group a move confers wins while the move is open (open_moves: the moves in force). Found by the character's own index (acts_group_moves, 0129) and joined to open_moves
  -- by its primary key, so the cost is the character's moves and not the instance's.
  select a.payload #>> '{params,group}' into open_group
  from acts a join open_moves o on o.move_act = a.id
  where a.kind = 'move' and a.payload ->> 'kind' = 'conferGroup' and a.payload #>> '{params,character}' = in_character::text
  order by o.landed_at desc, o.move_act desc limit 1;
  if open_group is not null then return open_group; end if;
  -- Else the highest rung whose condition holds, the highest first; the default rung holds for every character, so the walk ends.
  for r in select k.key, k.condition, k.at_least from group_kinds k where k.source = 'ladder' order by k.rung desc loop
    holds := case r.condition
      when 'default' then true
      when 'posts' then coalesce((select n.posts from character_post_counts n where n.character = in_character), 0) >= r.at_least
      when 'seasons' then (select count(*) from season_results x where x.character = in_character) >= r.at_least
      when 'staff' then exists (
        select 1 from characters c left join staff_office_now o on o.staff = c.staff
        where c.id = in_character and c.staff is not null and (c.staff_kind = 'developer' or o.office in ('boss', 'mod')))
      else null end;
    if holds is null then
      raise exception 'group "%" has condition kind %, which group_now has no case for', r.key, coalesce(r.condition, 'null') using errcode = '22023';
    end if;
    if holds then return r.key; end if;
  end loop;
  return null;
end $$;

create or replace view bars_now as
  select (a.payload #>> '{params,character}')::uuid as character, (a.payload #>> '{params,board}')::uuid as board, o.move_act, a.payload #>> '{params,group}' as "group",
         move_expires_at(o.move_act) as expires_at
  from open_moves o join acts a on a.id = o.move_act
  where a.kind = 'move' and a.payload ->> 'kind' = 'conferGroup' and a.payload #> '{params,board}' is not null and jsonb_typeof(a.payload #> '{params,board}') = 'string';

-- One character's bars: bars_now's rows for it, through the index. A public fact, as barred is and as the move's Act is, for any character; my_characters (a view the caller reads) calls it, so the API roles may execute it. Not expired: a move past its expiry that the tick has not yet ended bars no one.
create function bars_of(in_character uuid) returns table (board uuid, move_act uuid, "group" text, expires_at timestamptz)
language sql stable security definer set search_path = public, pg_temp as $$
  select (a.payload #>> '{params,board}')::uuid, o.move_act, a.payload #>> '{params,group}', move_expires_at(o.move_act)
  from acts a join open_moves o on o.move_act = a.id
  where a.kind = 'move' and a.payload ->> 'kind' = 'conferGroup' and a.payload #>> '{params,character}' = in_character::text
    and a.payload #> '{params,board}' is not null and jsonb_typeof(a.payload #> '{params,board}') = 'string'
    and coalesce(move_expires_at(o.move_act) > now(), true)
$$;
revoke execute on function bars_of(uuid) from public, anon;
grant execute on function bars_of(uuid) to authenticated, service_role;

create or replace function barred(in_character uuid, in_board uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from bars_of(in_character) b where b.board = in_board)
$$;

create or replace function not_barred(who uuid, on_board uuid) returns void
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  until timestamptz;
begin
  select max(b.expires_at) into until from bars_of(who) b where b.board = on_board;
  if exists (select 1 from bars_of(who) b where b.board = on_board) then
    raise exception '% is barred from posting on % until %',
      (select c.name from characters c where c.id = who), coalesce((select n.name from boards_now n where n.id = on_board), 'this board'),
      coalesce(to_char(date_trunc('minute', until + interval '59.999999 seconds') at time zone 'UTC', 'YYYY-MM-DD HH24:MI') || ' UTC', 'a time not yet set')
      using hint = 'kayfabb.refusal', errcode = '55000';
  end if;
end $$;

-- my_characters (0133), reading `bars` through bars_of. Everything else as 0133 wrote it.
create or replace view my_characters as
  select c.id, c.name, h.class_key as class, h.started_at as class_since,
         case when t.at > now() then t.at end as turn_opens_at,
         c.debuted_at, c.debut_loudness, c.retired_at,
         p.class_key as pending_class, p.loudness as pending_loudness, p.show_from as pending_show_from, p.show_to as pending_show_to,
         case when p.character is not null then next_settlement_at(now()) end as takes_effect_at,
         exists (select 1 from presence_hidden x where x.character = c.id) as presence_hidden,
         h.due_at as class_due_at,
         banned_until(c.id) as banned_until,
         (select cp.pronouns from character_profiles cp where cp.character = c.id) as pronouns,
         group_now(c.id) as "group",
         coalesce((select jsonb_agg(jsonb_build_object('board', b.board, 'move', b.move_act, 'group', b."group", 'expires_at', b.expires_at) order by b.board, b.move_act)
                   from bars_of(c.id) b), '[]'::jsonb) as bars
  from characters c
  cross join lateral (select x.class_key, x.started_at, x.due_at from class_history x where x.character = c.id order by x.started_at desc limit 1) h
  cross join lateral (
    select (select max(x.started_at) from class_history x
            where x.character = c.id and x.started_at > (select min(f.started_at) from class_history f where f.character = c.id))
           + span_interval((select s.value from settings s where s.key = 'turnCooldown')) as at
  ) t
  left join pending_turns p on p.character = c.id
  where c.owner = auth.uid();
