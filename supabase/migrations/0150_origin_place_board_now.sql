-- A board play's place names the board as it is called now. docs/plans/2026-11-11-origin-place-rename-plan.md, Task 1; issue #205, F2.
--
-- 0079 gave a spun thread's origin its place (`origin_place`), and for a card played on a board it read the board's name from `boards`.
-- Nothing is ever written to `boards` (0046): what a board is called now is computed by `boards_now`, from the board's latest
-- renameBoard move with no move_end, else its own row. So after a rename a spun thread read "spun from Whoops! on the board General"
-- while every other screen gave the board its new name. The link, by slug, was right.
--
-- The `board` branch now reads the slug and the name from `boards_now`, so the place follows the board: a rename in force shows, a
-- later one replaces it, and one that expires, is met or is reversed gives the earlier name back, with nothing more written.
-- play_reach.board references boards, and boards_now has a row for every board, so the read finds one row wherever 0079's join did.
--
-- A scalar subquery in the branch and not a join, for what it costs. `boards_now` holds a materialized step (the moves in force), so a
-- join to it cannot become a primary-key probe: it is computed whole, every board and its moves, on every read of this view, the thread
-- page's one row included, and a plan that nested the loop would walk every board for every row. The subquery runs only for a row
-- whose origin is a board play: one probe of `boards` and one pass over the moves in force (open_moves, a handful of rows, read once
-- per query). A thread not spun from a board play, which is nearly every thread, pays nothing. On a board's deep page the rows an
-- offset skips are computed too (issue #205, "Deep board pages"), so each skipped row spun from a board play adds that probe: about
-- 9 microseconds each, measured on 5,000 threads with half of them spun from a board play, 42 boards and 5 renames in force (offset
-- 2000: 16 to 22 ms before, 25 to 32 ms after). It grows with the offset, as the page already does, and not with players, Acts or boards.
--
-- The columns, their names, types and order are as 0079 left them, so this replaces the view in place: thread_list (`select *` from
-- thread_open) and the grants on both (0079) stand untouched. Everything else is as 0079 wrote it.

create or replace view thread_open as
  select t.id, t.board, t.title, t.origin_act_id, t.created_at, t.last_at, t.next_seq - 1 as last_seq, t.replies,
         f.id as first_act, f.character as first_character,
         l.id as last_act, l.character as last_character,
         (select count(*) from (
            select 1 from acts r where r.thread = t.id and r.kind = 'post' and r.seq > 1 and r.created_at > now() - interval '7 days'
            limit (select (h.value #>> '{}')::integer from settings h where h.key = 'hotReplies')
          ) capped) as replies_this_week,
         o.thread as origin_thread,
         case
           when o.id is null then null
           when o.kind = 'update' then jsonb_build_object('kind', 'update', 'act', o.id, 'title', o.payload ->> 'title')
           when o.kind in ('card', 'set', 'spring') then jsonb_build_object(
             'kind', 'play',
             'card', case when o.kind = 'set' then null else o.payload ->> 'card' end,
             'on', case
               when r.play is not null then case r.reach
                 when 'character' then jsonb_build_object('kind', 'character', 'id', r.character, 'name', rc.name)
                 when 'thread' then jsonb_build_object('kind', 'thread', 'id', r.thread, 'title', rt.title)
                 when 'board' then (select jsonb_build_object('kind', 'board', 'slug', n.slug, 'name', n.name) from boards_now n where n.id = r.board)
               end
               when p.kind = 'update' then jsonb_build_object('kind', 'update', 'act', p.id, 'title', p.payload ->> 'title')
               when p.seq is not null then jsonb_build_object('kind', 'post', 'thread', p.thread, 'title', pt.title, 'seq', p.seq)
               else null
             end)
           when o.seq is not null then jsonb_build_object('kind', 'post', 'thread', o.thread, 'title', ot.title, 'seq', o.seq)
           else null
         end as origin_place
  from threads t
  left join acts f on f.thread = t.id and f.seq = 1
  left join acts l on l.thread = t.id and l.seq = t.next_seq - 1
  left join acts o on o.id = t.origin_act_id
  left join threads ot on ot.id = o.thread
  left join acts p on p.id = o.target_act_id and o.kind in ('card', 'set', 'spring') and coalesce(o.payload ->> 'reach', 'post') = 'post'
  left join threads pt on pt.id = p.thread
  left join play_reach r on r.play = o.id
  left join characters_public rc on rc.id = r.character
  left join threads rt on rt.id = r.thread
  where t.id is distinct from (select (u.value #>> '{}')::uuid from settings u where u.key = 'updatesThread');
