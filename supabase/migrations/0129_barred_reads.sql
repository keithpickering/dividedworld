-- The barred box's read (docs/plans/2026-11-06-member-groups-plan.md, Task 10).
--
--   my_apologies(character)   the caller's own acting character's apologies (0125's `apologies`, which no client reads), newest first: the move each answers, its state
--                           (pending, accepted, rejected, returned), when it was written and when the next may be (created_at plus apologyEveryHours, as `apologize` (0126)
--                           counts it; none for a returned one, which opens the next at once). The barred box says "Your apology is with the Boss" or the time the next may be
--                           written from it.
--
--   my_characters             (0124) also carries `bars` as its last column: the boards the character is barred from posting on now, each {board, move, group, expires_at}
--                           (bars_now, 0125, less a move past its expiry that the tick has not yet ended), [] while it is barred from none. The composer and New thread say so from it
--                           without a read of their own, as they say a ban from `banned_until`.
--
-- Masks. A bar is a public fact (the move's Act names the character, the group and the board), carried here by the caller's own characters as a ban is; it says nothing a
-- thread's postbit does not. An apology is a public spin by the barred character, but its state (waiting, ruled) is read by its own player alone: the function returns rows only for a character the
-- caller plays, and the same empty answer for another player's character, an id that is no one's and a null, so it proves nothing about who owns what. The bar itself
-- (`bars_now`, 0125) is public and is read as it is.
-- Ways out. Read-only; it adds no state.

create function my_apologies(in_character uuid) returns table (move_act uuid, state text, created_at timestamptz, next_at timestamptz)
language sql stable security definer set search_path = public, pg_temp as $$
  select x.move_act, x.state, x.created_at,
         case when x.state = 'returned' then null else x.created_at + make_interval(hours => apology_setting('apologyEveryHours')) end
  from apologies x
  where x.character = in_character
    and exists (select 1 from characters c where c.id = in_character and c.owner = auth.uid())
  order by x.created_at desc, x.id desc
$$;
revoke execute on function my_apologies(uuid) from public, anon;
grant execute on function my_apologies(uuid) to authenticated;

-- my_characters (0124), also saying the boards each character is barred from (`bars`, its last column). Everything else as 0124 wrote it.
create or replace view my_characters as
  select c.id, c.name, h.class_key as class, h.started_at as class_since,
         case when t.at > now() then t.at end as turn_opens_at,
         c.debuted_at, c.debut_loudness, c.retired_at,
         p.class_key as pending_class, p.loudness as pending_loudness, p.show_from as pending_show_from, p.show_to as pending_show_to,
         case when p.character is not null then next_settlement_at(now()) end as takes_effect_at,
         exists (select 1 from presence_hidden x where x.character = c.id) as presence_hidden,
         h.due_at as class_due_at,
         banned_until(c.id) as banned_until,
         group_now(c.id) as "group",
         coalesce((select jsonb_agg(jsonb_build_object('board', b.board, 'move', b.move_act, 'group', b."group", 'expires_at', b.expires_at) order by b.board, b.move_act)
                   from bars_now b where b.character = c.id and coalesce(b.expires_at > now(), true)), '[]'::jsonb) as bars
  from characters c
  cross join lateral (select x.class_key, x.started_at, x.due_at from class_history x where x.character = c.id order by x.started_at desc limit 1) h
  cross join lateral (
    select (select max(x.started_at) from class_history x
            where x.character = c.id and x.started_at > (select min(f.started_at) from class_history f where f.character = c.id))
           + span_interval((select s.value from settings s where s.key = 'turnCooldown')) as at
  ) t
  left join pending_turns p on p.character = c.id
  where c.owner = auth.uid();
