-- A report, its verdict, an appeal and its ruling are origins with a place (docs/plans/2026-11-23-spin-mod-answers-plan.md, Task 1; docs/plans/2026-11-23-spin-mod-answers-design.md, sections 3, 4 and 6). The plan
-- numbered this 0420; 0420 and 0421 were taken by the time it was built.
--
--   1. spin_answer_place(origin), the place of an ask or an answer as a function, and thread_open (0396, section 2), its origin_place also naming an ask or an answer: `{kind: 'answer', spun: 'ask' | 'answer', ask: 'report' | 'appeal', asker: {id, name}, staff: {id, name} | null,
--      punishment: 'infraction' | 'ban' | 'move' | null, group: <the move's group key> | null, on: {kind: 'post', thread, title, seq} | null}`. `asker` is the ask's character as acts_public shows it (the stand-in
--      where a veil covers it); `staff` is the answer's character, null while an ask has none; `punishment` is the kind of the Act an appeal is of (null for a report); `group` is a move's params.group;
--      `on` is the post (a report's target; an infraction's about_act; a ban's infraction's about_act) or, for a move, the move's own line where it has a seq, else null. Everything else as 0396 wrote it.
--      A spin already made of a verdict, a ruling, a report or an appeal drew no place before and draws this one now: a view over Acts that did not change.
--   2. my_reports and my_appeals (0111_mod_screens.sql, the latest), each with one column added at the end: `verdict_act` and `ruling_act`, the answer's Act id from the join they already have (null: none yet).
--      The views are replaced in place, so their grants stay as 0111 gave them (select to authenticated, nothing to anon).
--
-- Cost (Weigh a design at the scale of a busy instance): the function's joins are by primary key or by the unique partial index of the answer's kind (acts_one_report_verdict, acts_one_appeal_ruling), and each is
-- reached only by a thread whose origin is one of the four kinds (the view calls the function for those kinds alone), and the view carries no join for it: every screen function that reads thread_open kept 0.6 to 4.6 MB more plan memory with the joins in the view (supabase/tests/e2e/0028-cold-read-budget.ts), and keeps none more with the function. supabase/tests/0422-spin-answers.sql measures a board's deep page (thread_list by board,
-- newest first, offset 2000 of 5,000 threads) with every other thread spun from a verdict against the same board spun from posts alone: 2,267 ms for the posts-only board and 2,350 ms for the half-spun one (best of three, in a transaction, a ratio of 1.04; the absolute figure is a transaction's plan, slower than an instance's after a VACUUM ANALYZE).
-- Ways out: no state is added; a spin is a thread like any other. Masks: the place reads public facts of public Acts (an ask's character through acts_public, names as characters_public gives them for a player's character, and from characters for a staff character (staff_kind is not null: a persona or the anonymous stand-in, public whether or not characters_public lists it). RULE: a player's character that has not debuted has no public name, so an ask by one draws no answer place (the thread falls through to its other branches, as before), and an answer by a non-staff character that has not debuted gives `staff` null; a staff character always names. `staff` is null otherwise only while an ask has no answer; it reads no owner,
-- class or reaction.

-- ===================================================================================== 1. spin_answer_place ====
-- The place of a thread spun from an ask or an answer, read by thread_open for those four kinds of origin and no other. It is a function and not joins in the view because every screen function that reads thread_open keeps
-- the view's plan on a connection (0368; supabase/tests/e2e/0028-cold-read-budget.ts): the ten joins it takes added 1.6 to 4.6 MB to every one of them, and a function is planned only where it is called. Security definer,
-- since it reads Acts and characters as the view's owner does; it answers only what the place says, from public Acts.
-- The ask is the report or the appeal (the origin, or its target); the answer is the verdict or the ruling (the origin, or found by target_act_id through the unique partial index of its kind); the punishment is an appeal's
-- target; the line is the post (a report's target, an infraction's about_act, a ban's infraction's about_act) or a move's own Act. The asker's character is read as acts_public shows it: the stand-in where a live author veil
-- covers the ask (post_veil_cover and post_veils_live, 0371's rule, which acts_public's second select applies), else the ask's character.
create function spin_answer_place(origin uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select case when xa.id is not null and (xc.staff_kind is not null or xcp.id is not null) then jsonb_build_object(
           'kind', 'answer',
           'spun', case when o.kind in ('report', 'appeal') then 'ask' else 'answer' end,
           'ask', xa.kind,
           'asker', jsonb_build_object('id', xc.id, 'name', coalesce(xcp.name, xc.name)),
           'staff', case when coalesce(xv.id, xr.id, xg.id) is not null and (xs.staff_kind is not null or xsp.id is not null) then jsonb_build_object('id', xs.id, 'name', coalesce(xsp.name, xs.name)) end,
           'punishment', xp.kind,
           'group', case when xp.kind = 'move' then xp.payload #>> '{params,group}' end,
           'on', case when xl.seq is not null then jsonb_build_object('kind', 'post', 'thread', xl.thread, 'title', xlt.title, 'seq', xl.seq) end) end
  from acts o
  left join acts xa on xa.id = case when o.kind in ('report', 'appeal') then o.id when o.kind in ('report_verdict', 'appeal_ruling') then o.target_act_id end
  left join characters xc on xc.id = case when exists (select 1 from post_veil_cover c join post_veils_live v on v.play = c.play and v.veil = 'author' where c.act = xa.id)
                                          then (select k.id from characters k where k.staff_kind = 'anonymous') else xa."character" end
  left join characters_public xcp on xcp.id = xc.id and xc.staff_kind is null
  left join acts xv on xv.id = o.id and o.kind in ('report_verdict', 'appeal_ruling')
  left join acts xr on xr.target_act_id = xa.id and o.kind = 'report' and xr.kind = 'report_verdict'
  left join acts xg on xg.target_act_id = xa.id and o.kind = 'appeal' and xg.kind = 'appeal_ruling'
  left join characters xs on xs.id = coalesce(xv."character", xr."character", xg."character")
  left join characters_public xsp on xsp.id = xs.id and xs.staff_kind is null
  left join acts xp on xp.id = xa.target_act_id and xa.kind = 'appeal'
  left join acts xb on xb.id = case when xp.kind = 'ban' then (xp.payload ->> 'infraction_act')::uuid end
  left join acts xl on xl.id = case when xa.kind = 'report' then xa.target_act_id
                                    when xp.kind = 'infraction' then (xp.payload ->> 'about_act')::uuid
                                    when xp.kind = 'ban' then (xb.payload ->> 'about_act')::uuid
                                    when xp.kind = 'move' then xp.id end
  left join threads xlt on xlt.id = xl.thread
  where o.id = origin
$$;
-- thread_open reads it as its owner, so no API role calls it (as 0357 closes stand_in and shown_author).
revoke execute on function spin_answer_place(uuid) from public, anon, authenticated, service_role;

-- ===================================================================================== 2. thread_open ====
-- thread_open (0396), its origin_place also naming an ask or an answer, before the last branch (a post). Everything else as 0396 wrote it.

create or replace view thread_open as
  select t.id, t.board, t.title, t.origin_act_id, t.created_at, t.last_at, t.next_seq - 1 as last_seq, t.replies,
         f.id as first_act, case when exists (select 1 from post_veils_live sv where sv.post = f.id and sv.veil = 'author') then (select sk.id from characters sk where sk.staff_kind = 'anonymous') else f.character end as first_character,
         l.id as last_act, case when exists (select 1 from post_veils_live sv where sv.post = l.id and sv.veil = 'author') then (select sk.id from characters sk where sk.staff_kind = 'anonymous') else l.character end as last_character,
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
             end,
             'from', case when cf.seq is not null then jsonb_build_object('kind', 'post', 'thread', cf.thread, 'title', cft.title, 'seq', cf.seq) else null end,
             'at', case when sp.seq is not null then jsonb_build_object('kind', 'post', 'thread', sp.thread, 'title', spt.title, 'seq', sp.seq) else null end)
           when o.kind = 'poll' and pp.seq is not null then jsonb_build_object('kind', 'poll', 'question', o.payload ->> 'question',
             'on', jsonb_build_object('kind', 'post', 'thread', pp.thread, 'title', ppt.title, 'seq', pp.seq))
           when o.kind = 'ballot' and pp.seq is not null and bc.id is not null then jsonb_build_object('kind', 'ballot', 'character', jsonb_build_object('id', bc.id, 'name', bc.name), 'question', bp.payload ->> 'question',
             'on', jsonb_build_object('kind', 'post', 'thread', pp.thread, 'title', ppt.title, 'seq', pp.seq))
           when o.kind in ('report', 'report_verdict', 'appeal', 'appeal_ruling') then spin_answer_place(o.id)
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
  -- The cast-from post of a play on a character, and the post a spin was pressed at: each a probe by primary key that finds nothing for any other thread.
  left join acts cf on cf.id = o.target_act_id and o.kind = 'card' and o.payload ->> 'reach' = 'character'
  left join threads cft on cft.id = cf.thread
  left join acts sp on sp.id = case when f.kind = 'spin' then (f.payload ->> 'at')::uuid end
  left join threads spt on spt.id = sp.thread
  -- A poll's post, and a ballot's poll and its character as acts_public shows it (a secret ballot has none, and is no origin): each a probe by primary key that finds nothing for any other thread.
  left join acts bp on bp.id = o.target_act_id and o.kind = 'ballot'
  left join acts pp on pp.id = case when o.kind = 'poll' then o.target_act_id when o.kind = 'ballot' then bp.target_act_id end
  left join threads ppt on ppt.id = pp.thread
  left join acts_public ab on ab.id = o.id and o.kind = 'ballot'
  left join characters_public bc on bc.id = ab."character"
  where t.id is distinct from (select (u.value #>> '{}')::uuid from settings u where u.key = 'updatesThread');

-- ===================================================================================== 3. my_reports, my_appeals ====
-- my_reports and my_appeals (0111), each with its answer's id as a last column. Replaced in place (a column added at the end), so the grants and the views' dependents stay. Everything else as 0111 wrote it.
create or replace view my_reports as
  select r.id as report, c.id as character, r.created_at as at, r.target_act_id as post, (select p.seq from acts p where p.id = r.target_act_id) as post_seq, r.thread,
         v.payload ->> 'verdict' as verdict, v.created_at as verdict_at, (select m.name from characters m where m.id = v.character) as mod_name,
         (select f.why from report_refunds f where f.report_act = r.id) as refund,
         v.id as verdict_act
  from characters c
  join acts r on r.kind = 'report' and r.character = c.id
  left join acts v on v.kind = 'report_verdict' and v.target_act_id = r.id
  where c.owner = auth.uid();

create or replace view my_appeals as
  select a.id as appeal, c.id as character, a.created_at as at, a.target_act_id as punishment, p.kind as punishment_kind,
         (select x.seq from acts x where x.id = case when p.kind = 'infraction' then (p.payload ->> 'about_act')::uuid else (select (i.payload ->> 'about_act')::uuid from acts i where i.id = (p.payload ->> 'infraction_act')::uuid) end) as post_seq,
         a.thread, r.payload ->> 'verdict' as verdict, r.created_at as ruled_at, (r.payload ->> 'points_delta')::integer as points_delta,
         (select m.name from characters m where m.id = r.character) as hearer_name,
         (select f.why from appeal_refunds f where f.appeal_act = a.id) as refund,
         r.id as ruling_act
  from characters c
  join acts a on a.kind = 'appeal' and a.character = c.id
  join acts p on p.id = a.target_act_id
  left join acts r on r.kind = 'appeal_ruling' and r.target_act_id = a.id
  where c.owner = auth.uid();
