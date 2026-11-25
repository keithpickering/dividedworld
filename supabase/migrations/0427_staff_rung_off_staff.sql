-- A staff persona keeps the staff rung's bar off staff: group_now's `staff` condition holds for every staff character, not only one holding an office.
--
-- What was wrong: the staff rung's condition (0128, the member groups design, section 4) was "holds a staff office", so a Boss whose season ended or a Mod Bot fired back to
-- the member office lost its Personality Cores bar and wore the Members bar like a player's character. The owner, reporting it: "Having the abilities of a normal member is
-- the right idea, but they should still be listed as a Personality Core." A staff persona is a Personality Core, played by The System, whatever office it holds; an office is
-- a role it holds for a while, shown by its badge (ADMINISTRATOR, MODERATOR, or none), and its powers follow the office alone, unchanged here. The demo data (engine/ui/data/fake.ts) already gave the rung to every staff character; the database now agrees with it.
--   group_now  as 0357 wrote it, except the `staff` condition: a character with a `staff` key (a persona in any office, or the developer), where it was a persona holding
--              the Boss's or a Mod Bot's office, or the developer. A conferred group still wins while its move is open, and the veil's stand-in still has no group.
-- Masks. Who is staff is public (characters_public.staff), so the bar is computed from a public fact, as before. Ways out. Adds no state. Cost: the same primary-key read, one join fewer.

create or replace function group_now(in_character uuid) returns text
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  r record;
  posts integer;
  holds boolean;
  open_group text;
begin
  -- The stand-in a veil shows is no scored character, holds no rung and is no Mod Bot: no group, so no screen draws a bar (the postbit's) or a Group row (the profile's) for it, and none can say it is staff.
  if exists (select 1 from characters c where c.id = in_character and c.staff_kind = 'anonymous') then return null; end if;
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
      when 'posts' then coalesce((select n.posts from character_counts_shown n where n.character = in_character), 0) >= r.at_least
      when 'seasons' then (select count(*) from season_results x where x.character = in_character) >= r.at_least
      -- Every staff character, whatever office it holds or has left: a persona off staff is still played by The System (0427).
      when 'staff' then exists (select 1 from characters c where c.id = in_character and c.staff is not null)
      else null end;
    if holds is null then
      raise exception 'group "%" has condition kind %, which group_now has no case for', r.key, coalesce(r.condition, 'null') using errcode = '22023';
    end if;
    if holds then return r.key; end if;
  end loop;
  return null;
end $$;
