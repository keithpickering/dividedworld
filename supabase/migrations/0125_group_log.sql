-- The log's lines for a staff member moving one of the player's characters into a group (docs/plans/2026-11-06-member-groups-plan.md, Task 11).
--
--   my_group_moves   A row for each landed `conferGroup` move on one of the caller's own characters: the move's Act and its place in the announcements thread (what the line
--                    links to), the character, the group's key and the board it bars (with the board's name), when it ends now (move_expires_at, so an appeal's ruling is read in
--                    place of the move's own end) and when it was set to end as it landed (`landed_until`, the Act's own), a favor's check, the office the move landed under (the stamp 0128 writes on the Act, else the Boss's; the line's role word, and the hearer's, who is the move's own staff member), how the move ended (`ended_why`: met, expired, reversed, unmet,
--                    overturned, superseded or spent; `ended_by`), and the latest appeal ruling on it (verdict, when, the end it set): a refunded appeal can be made again, so a move may have several appeals and still has one row. The group's name is not here: it
--                    is the instance's own content, which the screen holds.
--
-- Masks. A group move, its end and a ruling are public Acts, so every column is a public fact about the character. The view keeps only the caller's own characters
-- (characters' own-rows policy and `owner = auth.uid()`), as my_bans does, so a third player sees nothing and no row says who else is in a group. No alert: the log is where it shows.
-- Ways out. The view is a read; each row says how the move ends (its end, its demand, an appeal or an admin) in the words the screen puts beside it.

create view my_group_moves with (security_invoker = true) as
  select m.id as move, c.id as character, m.created_at as at, m.thread, m.seq, m.payload #>> '{params,group}' as "group",
         case when jsonb_typeof(m.payload #> '{params,board}') = 'string' then (m.payload #>> '{params,board}')::uuid end as board,
         (select b.name from boards_now b where b.id = case when jsonb_typeof(m.payload #> '{params,board}') = 'string' then (m.payload #>> '{params,board}')::uuid end) as board_name,
         move_expires_at(m.id) as expires_at, case when jsonb_typeof(m.payload -> 'expires_at') = 'string' then (m.payload ->> 'expires_at')::timestamptz end as landed_until,
         case when jsonb_typeof(m.payload #> '{params,checkAt}') = 'string' then (m.payload #>> '{params,checkAt}')::timestamptz end as check_at,
         m.payload #>> '{demand,kind}' as demand,
         coalesce(nullif(m.payload ->> 'office', ''), 'boss') as office,
         e.payload ->> 'why' as ended_why, e.payload ->> 'by' as ended_by, e.created_at as ended_at,
         r.payload ->> 'verdict' as ruling, r.created_at as ruled_at,
         case when jsonb_typeof(r.payload -> 'until') = 'string' then (r.payload ->> 'until')::timestamptz end as ruled_until
  from characters c
  join acts m on m.kind = 'move' and m.payload ->> 'kind' = 'conferGroup' and m.payload #>> '{params,character}' = c.id::text
  left join acts e on e.kind = 'move_end' and e.target_act_id = m.id
  left join lateral (
    select ru.* from acts ap join acts ru on ru.kind = 'appeal_ruling' and ru.target_act_id = ap.id
    where ap.kind = 'appeal' and ap.target_act_id = m.id order by ru.created_at desc, ru.id desc limit 1
  ) r on true
  where c.owner = auth.uid();

revoke all on my_group_moves from public, anon, authenticated;
grant select on my_group_moves to authenticated;
