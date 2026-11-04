-- A spun thread's origin, wherever it is: thread_open and thread_list carry its place. docs/plans/2026-11-04-origin-place-design.md,
-- section 2; its plan, Task 1.
--
-- Since 0063 the two views gave a spun thread's origin as three columns: the origin Act's thread (origin_thread), that thread's title
-- (origin_title) and the Act's own place number (origin_seq). A card, a face-down set and a trap's spring take no place number
-- (acts_take_seq, 0035 and 0054), so a thread spun from a play had a null origin_seq, and both screens dropped the link: the board's
-- row drew no "spun from" line and the ORIGIN box's head fell back to "an Act". An update's spin read as "#N in Updates", a link into
-- a thread thread_open leaves out. A play can also land beyond a post (0055): on a character, a thread or a board, a `play_reach` row.
--
-- origin_title and origin_seq are gone, and one `origin_place` jsonb replaces them as the views' last column, worked out in the row's
-- own query from primary-key joins (the origin Act, the post a play landed on and its thread, the play's one play_reach row and
-- the character, thread or board it names), so a board's page still costs its page. origin_thread stays: the ORIGIN box subscribes to
-- it. The shapes are `engine/ui/data/api.ts`'s PlaceOn and OriginPlace, and the rules, in order, are:
--   - no origin Act: null;
--   - an update: { kind: 'update', act, title };
--   - a card, a set or a spring: { kind: 'play', card, on }. `card` is the card's key, and null for a set, so a face-down card's
--     place never names its trap (the key is the setter's alone, "A response never proves a private fact"); a spring is its own Act
--     and reads its own card. `on` is the play_reach row's one target where the play has one (a character with its name from
--     characters_public, so null for one that has not debuted; a thread with its title; a board with its slug and name), else the
--     update the play's target Act is, else the post it is on (its thread, that thread's title, its place number), else null.
--     The kind is tested before the place number, so a legacy numbered card (0035's leftover) is a play and never `#N` in a place
--     no page draws;
--   - any other Act with a place number: { kind: 'post', thread, title, seq };
--   - otherwise null.
--
-- Nothing reads the two dropped columns but the views' own readers: no database function selects them and no view or `begin atomic`
-- function depends on these views, so the drops are plain, and a dependency that shows up fails this migration rather than being dropped
-- silently. thread_list (0063) is thread_open less the unlisted threads; the updates thread (0062) and the grants (0045, 0063)
-- are as before. Everything else as 0063 wrote it.

drop view thread_list;
drop view thread_open;

create view thread_open as
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
                 when 'board' then jsonb_build_object('kind', 'board', 'slug', rb.slug, 'name', rb.name)
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
  left join boards rb on rb.id = r.board
  where t.id is distinct from (select (u.value #>> '{}')::uuid from settings u where u.key = 'updatesThread');

-- thread_open less the unlisted threads (0063), ids compared as uuids so a join on thread_list keeps its index.
create view thread_list as
  select * from thread_open t
  where not exists (select 1 from unlisted_threads x where x.thread = t.id);

-- A view dropped and made again is granted again: nothing but a signed-in player reads either, and the digest reads the list (0045).
revoke all on thread_open, thread_list from public, anon, authenticated;
grant select on thread_open to authenticated;
grant select on thread_list to authenticated, kayfabb_digest;
