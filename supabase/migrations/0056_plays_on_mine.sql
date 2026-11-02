-- The log names a play's place. docs/plans/2026-11-02-alerts-plan.md, Task 1; docs/plans/2026-11-02-alerts-design.md, sections 9 and 10.
--
-- my_posts_played_on (0043, then 0055) is the plays other players landed on the caller's own things. 0055 narrowed it to a post's
-- plays, because a character or thread play sits on a post and the post's author's log would otherwise say it was played on their
-- post ("The fiction may lie; the log never does"). It now says each play for what it is: the plays on a post one of the caller's
-- characters wrote, on one of their characters (play_reach.character), and on a thread one of their characters started
-- (play_reach.thread; the thread's first Act's author, who is the thread's starter). Each row gains
--   reach        'post', 'character' or 'thread'; a play written before 0055 names none and is a post's
--   target_name  the target's public name: the character's name, or the thread's title; null for a post, which the log names by
--                its author and number from the Acts it reads
-- `post` stays the post the play sits on (a character play's is the post it was played from, a thread play's the thread's first), so
-- the log still links one. A play by one of the caller's own characters is left out, as it always was: it is the caller's card ledger's.
-- A board has no owner, so a board play is no one's row; the caller who played it reads it in their own card ledger.
--
-- The masks: the view is each caller's own rows, filtered by auth.uid() on the target's owner as 0043 filtered on the post's, and a
-- name here is a public one (characters.name and threads.title are on every public page). Nothing is computed from who played it.
-- Everything else, and the grants, as 0055 wrote them.
create or replace view my_posts_played_on as
  select k.id as play, k.target_act_id as post, k.created_at as at, e.saved_at,
         coalesce(pr.reach, 'post') as reach,
         case pr.reach when 'character' then tc.name when 'thread' then th.title end as target_name
  from acts k
  join characters by_whom on by_whom.id = k.character
  left join play_reach pr on pr.play = k.id
  left join acts p on p.id = k.target_act_id
  left join characters pc on pc.id = p.character
  left join characters tc on tc.id = pr.character
  left join threads th on th.id = pr.thread
  left join acts opening on opening.thread = pr.thread and opening.seq = 1
  left join characters sc on sc.id = opening.character
  left join effect_state e on e.play = k.id
  where k.kind = 'card' and by_whom.owner is distinct from auth.uid()
    and (case coalesce(pr.reach, 'post')
           when 'post' then pc.owner
           when 'character' then tc.owner
           when 'thread' then sc.owner
         end) = auth.uid()
    and (pr.play is not null or coalesce(k.payload ->> 'reach', 'post') = 'post');

revoke all on my_posts_played_on from anon, public;
grant select on my_posts_played_on to authenticated;
