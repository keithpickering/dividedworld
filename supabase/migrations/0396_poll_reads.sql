-- Polls: the reads (docs/plans/2026-11-20-polls-design.md; plan docs/plans/2026-11-20-polls-plan.md, Task 2; models 0375_spun_thread_reads.sql, 0372_origin_in_page.sql and 0377_sealed_packs.sql).
--
-- 0395 wrote the kinds, the writes and the guards. This reads them back, in the screens' own reads, and changes nothing 0395 wrote. Each function and view below is copied whole from its latest definition (named in the comment above it), changing only what is named.
--
--   1. poll_ballots    (poll, before, before_id): a public poll's every ballot, the changes included, newest first, 50 at a time paged by the keyset (at, act) of the last one, each with its character's public name and avatar; it refuses a secret poll in one sentence. And my_poll_closes, an
--                       owner-rights view of an admin's closes of the polls the caller's characters wrote (as my_ballots is the caller's own ballots), which the log reads: the poll's character through acts_public may be the veil's stand-in.
--   2. thread_open     `origin_place` names a poll ({kind: 'poll', question, on}) and a public ballot ({kind: 'ballot', character: {id, name}, question, on}), `on` being the poll's post's `post` place ({kind: 'post', thread, title, seq}).
--                       A secret ballot is named by no origin (acts_public gives it no character). thread_list is select * from it and follows.
--   3. thread_page     gains, for the current poll of each post it draws (the page's posts, the posts nested under a play, and the origin's post): `polls` ([{post, act, counts, voters, ends_at, closed, close, balloted}]: the poll Act as acts_public
--                       shows it, its poll_counts row and its close Act or null), `voters` ([{poll, act, character, picks, at}]: a public poll's counted ballots with picks, newest first, 50 at most for each poll), `votersMore` (the ids of the
--                       polls whose voters are more than the 50 listed), `voterCast` (each voter's `{character, profile}` head, as the origin's `cast` holds them, never `people`) and `myBallots` ([{act, poll, character, picks, at}]: the
--                       caller's own counted ballots on these polls, from my_ballots, a secret one's and a withdrawal's too). The polls' ids join `ids`, so `spun` holds the threads spun from each. Where the origin is a poll or a ballot,
--                       `origin` carries `polls`, `voters`, `votersMore` and `myBallots` for that poll the same way, its voters join `origin.cast`, and `origin.at` is the poll's post ({thread, seq}).
--   4. log_page        gains two sources: `ballots` (the caller's own ballots in the window: {act, poll, character, picks, at, question, secret, options, changed, place}; `options` are the poll's, to word the picks, and `changed` is whether the character's previous ballot on the poll picked something: a withdrawal after a pick is a change, and a cast after a withdrawal is a cast, "cast a ballot for X") and `pollCloses` (an admin's closes of polls the caller's characters wrote:
--                       {act, poll, character, at, question, place}), `place` being the poll's post's `post` place.
--   5. system_digest   an excerpt whose post has a current poll gains `poll: {question, options: [{text, count}], closed}`. It names no voter, public or secret. The digest's role reads acts_public and now poll_counts (granted here: a
--                       view of characters counted that reads no owner), and no my_* view.
--
-- Masks ("A response never proves a private fact"): every poll part of the page is computed from acts_public (a secret ballot has no character there, for every reader alike) and poll_counts (characters counted, no owner read), so the
-- parts of a secret poll are byte for byte the same for every caller; `myBallots` is the caller's own, from my_latest_ballots (and my_ballots for a ballot created after its poll's end), and the only part that differs. `voters` is read only for a public poll, `poll_ballots` refuses a secret one
-- whatever the caller, and the digest carries counts and no one.
--
-- A busy instance: nothing limits how often a character changes its ballot, so no read here costs the ballots cast. The counts are poll_counts', one pass over a poll's voters through poll_latest_ballots (each character's latest ballot,
-- 0395) for each poll on the page, and a poll's voters are poll_voter_acts', the newest of those rows stopped at 50; the voters' rows are then read through acts_public by primary key, for those ids alone. The caller's own ballots are
-- my_latest_ballots', a row for each poll they voted on. A page reads one poll for each post it draws (a probe of acts_polls, newest first, one row), so the read grows with the page's posts and the polls' voters, never with the instance's
-- Acts or the changes of ballots. poll_ballots (the history of every ballot) reads one page by a keyset on (created_at, id) through acts_ballots_recent and returns 50: its cost is the page's, however deep.
--
-- A veiled author's own ballots on a poll of the veiled post are read through acts_public, which shows the stand-in for them, so they group under the stand-in in `voters` (one entry for the stand-in's latest, where poll_counts counts the true
-- characters): `voters` listed can differ from the count by one for that author. Accepted: the veil hides who the author is, and the list is the page's shown voters.
--
-- Ways out: no state is added.

-- ===================================================================================== 1. poll_ballots, my_poll_closes ====
-- Two indexes and two readers of a poll's ballots, each a definer over base `acts` for the ids alone (an invoker reads no `character` of `acts`; the ids of a public poll's ballots are public, and both return nothing for a secret poll
-- whatever the caller). What they hand on goes through acts_public by primary key, so the veil's stand-in and every other mask of the projection apply.
--   acts_ballots_recent  a poll's ballots newest first: the voter list's walk and poll_ballots' keyset pages read it in order and stop at their limit.
--   Both clamp `most` to 51 (a page and the one that says there is more), so a direct call can never walk a poll's every ballot.
--   poll_voter_acts      (poll, ends, most): the ids of a poll's counted ballots with picks, newest first, `most` at most. It reads poll_latest_ballots (each character's latest ballot, kept by a trigger on the ballot's insert) from the newest
--                        back and stops at `most` (a withdrawal counts for its character and lists none), and for a character whose latest was created at or after `ends` it probes acts_ballots for its latest before it. Its cost is the
--                        voters listed, and never the ballots cast: a character that changed its ballot 200,000 times is one row.
--   poll_ballot_acts     (poll, before, before_id, most): the ids of a poll's ballots, every one, newest first, strictly older than the cursor (at, act) as a keyset on (created_at, id): ballots that tie on their time across a page edge are
--                        neither skipped nor repeated, and a deep page costs what the first does. A cursor with no act reads strictly older times alone.
create index acts_ballots_recent on acts (target_act_id, created_at desc, id desc) where kind = 'ballot';

create function poll_voter_acts(poll uuid, ends timestamptz, most integer) returns setof uuid rows 50
language plpgsql stable security definer set search_path = public, pg_temp set plan_cache_mode = force_custom_plan as $$
begin
  if ballot_secret(poll_voter_acts.poll) then return; end if;
  -- The newest latest ballots that pick something and were created before the poll's end, from poll_latest_ballots_picked in order, stopped at the limit; and the ballots of characters whose latest was created at or after the end,
  -- each replaced by that character's latest before it (a probe of acts_ballots), which are as few as the ballots that raced a close. The two are merged newest first and cut at the limit again.
  return query
    select u.id from (
      (select r.act as id, r.created_at from poll_latest_ballots r
       where r.poll = poll_voter_acts.poll and r.created_at < poll_voter_acts.ends and jsonb_array_length(r.picks) > 0
       order by r.created_at desc, r.act desc limit least(poll_voter_acts.most, 51))
      union all
      select l.id, l.created_at from poll_latest_ballots r
      cross join lateral (select x.id, x.created_at, x.payload from acts x where x.kind = 'ballot' and x.target_act_id = poll_voter_acts.poll and x."character" = r."character" and x.created_at < poll_voter_acts.ends
                          order by x.created_at desc, x.id desc limit 1) l
      where r.poll = poll_voter_acts.poll and r.created_at >= poll_voter_acts.ends and jsonb_array_length(l.payload -> 'picks') > 0) u
    order by u.created_at desc, u.id desc limit least(poll_voter_acts.most, 51);
end $$;
revoke execute on function poll_voter_acts(uuid, timestamptz, integer) from public, anon;
grant execute on function poll_voter_acts(uuid, timestamptz, integer) to authenticated;

create function poll_ballot_acts(poll uuid, before timestamptz, before_id uuid, most integer) returns setof uuid rows 51
language sql stable security definer set search_path = public, pg_temp as $$
  select b.id from acts b
  where b.kind = 'ballot' and b.target_act_id = poll_ballot_acts.poll and not ballot_secret(poll_ballot_acts.poll)
    and (b.created_at, b.id) < (coalesce(poll_ballot_acts.before, 'infinity'::timestamptz),
                                coalesce(poll_ballot_acts.before_id, case when poll_ballot_acts.before is null then 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid else '00000000-0000-0000-0000-000000000000'::uuid end))
  order by b.created_at desc, b.id desc
  limit least(poll_ballot_acts.most, 51)
$$;
revoke execute on function poll_ballot_acts(uuid, timestamptz, uuid, integer) from public, anon;
grant execute on function poll_ballot_acts(uuid, timestamptz, uuid, integer) to authenticated;

-- poll_ballots (poll, before, before_id): a public poll's ballots, every one (a change of ballot and a withdrawal are each a ballot) and not only the counted ones, newest first, 50 at a time. The cursor is the `at` and the `act` of the last
-- ballot a page gave: a keyset on (created_at, id), so a tie across a page edge loses none and a deep page costs what the first does. Each ballot carries its character's public name and avatar. It refuses a secret poll whatever the
-- caller (the same sentence for every caller) and a poll that is not there. An invoker reading acts_public by id, as thread_page does (a secret ballot has no character there), with the generic plan and no JIT every client read keeps (0368).
create function poll_ballots(poll uuid, before timestamptz default null, before_id uuid default null) returns jsonb
language plpgsql stable set search_path = public, pg_temp set plan_cache_mode = force_generic_plan set jit = off as $$
declare
  p record;
begin
  select a.id, (a.payload ->> 'secret')::boolean as secret into p from acts_public a where a.id = poll_ballots.poll and a.kind = 'poll' and not (a.payload ? 'removed');
  if p.id is null then raise exception 'there is no such poll' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
  if p.secret then raise exception 'that poll''s ballots are secret' using hint = 'kayfabb.refusal', errcode = '55000'; end if;
  return (
    with page as materialized (
      select b.id, b."character", b.payload -> 'picks' as picks, b.created_at
      from poll_ballot_acts(p.id, poll_ballots.before, poll_ballots.before_id, 51) v(act) cross join lateral (select x.id, x."character", x.payload, x.created_at from acts_public x where x.id = v.act) b
      order by b.created_at desc, b.id desc
    ), shown as materialized (
      select s.* from page s order by s.created_at desc, s.id desc limit 50
    )
    select jsonb_build_object(
      'ballots', coalesce((select jsonb_agg(jsonb_build_object('act', s.id, 'character', jsonb_build_object('id', c.id, 'name', c.name, 'avatar_square', pr.avatar_square, 'avatar_portrait', pr.avatar_portrait),
                                                           'picks', s.picks, 'at', s.created_at) order by s.created_at desc, s.id desc)
                           from shown s join characters_public c on c.id = s."character" left join character_profiles pr on pr."character" = c.id), '[]'::jsonb),
      'more', (select count(*) from page) > 50));
end $$;
revoke execute on function poll_ballots(uuid, timestamptz, uuid) from public, anon;
grant execute on function poll_ballots(uuid, timestamptz, uuid) to authenticated;

-- my_poll_closes: an admin's closes of the polls the caller's characters wrote, the caller's own rows (the poll's character through acts_public may be the veil's stand-in, so the log reads the owner's). Owner rights, filtered by
-- auth.uid() as my_ballots is; the log reads it and nothing else does.
create view my_poll_closes as
  select k.id as act, k.target_act_id as poll, p."character" as "character", k.created_at
  from acts k join acts p on p.id = k.target_act_id and p.kind = 'poll'
  where k.kind = 'poll_close' and k.payload ->> 'by' = 'admin' and p."character" in (select c.id from characters c where c.owner = auth.uid());
revoke all on my_poll_closes from public, anon, authenticated, service_role;
grant select on my_poll_closes to authenticated;

-- The digest's role reads the counts: poll_counts counts characters and reads no owner, the same for every caller (it is not a my_* view, which the role may not read).
grant select on poll_counts to kayfabb_digest;

-- ===================================================================================== 2. thread_open ====
-- thread_open (0357_post_veils.sql), its origin_place also naming a poll and a public ballot as an origin. Everything else as 0357 wrote it.

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

-- ===================================================================================== 3. thread_page ====
-- thread_page (0375_spun_thread_reads.sql), with the poll parts described at the top of this file: the CTEs o_post to pl_mine before `ids`, `ids`, `heads` and the document's parts, and `origin.at` for a poll's origin. Everything else as 0375 wrote it.
CREATE OR REPLACE FUNCTION public.thread_page(in_thread uuid, in_page integer, in_seq integer, per_page integer, effect_cards text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
 SET plan_cache_mode TO 'force_generic_plan'
 SET jit TO 'off'
AS $function$
#variable_conflict use_column
begin
  perform
         CASE
             WHEN ((COALESCE(per_page, ( SELECT ((x.settings ->> 'postsPerPage'::text))::integer AS int4
                FROM screen_settings x
              LIMIT 1)) IS NULL) OR ((COALESCE(per_page, ( SELECT ((x.settings ->> 'postsPerPage'::text))::integer AS int4
                FROM screen_settings x
              LIMIT 1)) < 1) OR (COALESCE(per_page, ( SELECT ((x.settings ->> 'postsPerPage'::text))::integer AS int4
                FROM screen_settings x
              LIMIT 1)) > 100))) THEN screen_refusal('a page holds 1 to 100 posts'::text)
             ELSE NULL::integer
         END AS "case";
  return (
  WITH pp AS MATERIALIZED (
          SELECT COALESCE(per_page, ( SELECT ((x.settings ->> 'postsPerPage'::text))::integer AS int4
                    FROM screen_settings x
                  LIMIT 1)) AS n
         ), s AS MATERIALIZED (
          SELECT o.id,
             o.board,
             o.title,
             o.origin_act_id,
             o.created_at,
             o.last_at,
             o.last_seq,
             o.replies,
             o.first_act,
             o.first_character,
             o.last_act,
             o.last_character,
             o.replies_this_week,
             o.origin_thread,
             o.origin_place,
             (GREATEST((1)::numeric, ceil(((o.last_seq)::numeric / (( SELECT pp.n
                    FROM pp))::numeric))))::integer AS last_page
            FROM thread_open o
           WHERE (o.id = thread_page.in_thread)
         ), pg AS MATERIALIZED (
          SELECT s.id,
             s.board,
             s.title,
             s.origin_act_id,
             s.created_at,
             s.last_at,
             s.last_seq,
             s.replies,
             s.first_act,
             s.first_character,
             s.last_act,
             s.last_character,
             s.replies_this_week,
             s.origin_thread,
             s.origin_place,
             s.last_page,
             LEAST(s.last_page, GREATEST(1, COALESCE(
                 CASE
                     WHEN (thread_page.in_seq IS NOT NULL) THEN (GREATEST((1)::numeric, ceil(((thread_page.in_seq)::numeric / (( SELECT pp.n
                        FROM pp))::numeric))))::integer
                     ELSE NULL::integer
                 END, thread_page.in_page, 1))) AS page
            FROM s
         ), rng AS MATERIALIZED (
          SELECT pg.id,
             pg.board,
             pg.title,
             pg.origin_act_id,
             pg.created_at,
             pg.last_at,
             pg.last_seq,
             pg.replies,
             pg.first_act,
             pg.first_character,
             pg.last_act,
             pg.last_character,
             pg.replies_this_week,
             pg.origin_thread,
             pg.origin_place,
             pg.last_page,
             pg.page,
             (((pg.page - 1) * ( SELECT pp.n
                    FROM pp)) + 1) AS first_seq,
             (pg.page * ( SELECT pp.n
                    FROM pp)) AS end_seq
            FROM pg
         ), range_acts AS MATERIALIZED (
          SELECT a.id,
             a."character",
             a.kind,
             a.thread,
             a.target_act_id,
             a.seq,
             a.created_at,
             a.payload,
             a.current_payload,
             a.edited_at,
             a.shown_edited_at,
             a.untaken,
             a.ends_at,
             a.hidden,
             a.any_hidden,
             a.concealing,
             a.payload_hidden,
             a.payload_concealing
            FROM acts_public a,
             rng
           WHERE ((a.thread = rng.id) AND ((a.seq >= rng.first_seq) AND (a.seq <= rng.end_seq)) AND (a.kind <> ALL (ARRAY['edit'::text, 'card'::text])))
         ), drawn AS MATERIALIZED (
          SELECT r.id,
             r.seq,
             r.kind,
             u.play,
             u.parent
            FROM (range_acts r
              CROSS JOIN LATERAL ( SELECT x.play,
                     x.parent
                    FROM post_under x
                   WHERE (x.reply = r.id)) u)
           WHERE (NOT card_ended(u.play))
         ), page_acts AS MATERIALIZED (
          SELECT r.id,
             r."character",
             r.kind,
             r.thread,
             r.target_act_id,
             r.seq,
             r.created_at,
             r.payload,
             r.current_payload,
             r.edited_at,
             r.shown_edited_at,
             r.untaken,
             r.ends_at,
             r.hidden,
             r.any_hidden,
             r.concealing,
             r.payload_hidden,
             r.payload_concealing
            FROM range_acts r
           WHERE (NOT (EXISTS ( SELECT 1
                    FROM drawn d
                   WHERE (d.id = r.id))))
         ), page_posts AS MATERIALIZED (
          SELECT a.id,
             a."character",
             a.created_at
            FROM page_acts a
           WHERE post_kind(a.kind)
         ), nested AS MATERIALIZED (
          SELECT u.play,
             p.id AS parent,
             a.id,
             a."character",
             a.created_at,
             to_jsonb(a.*) AS act
            FROM ((page_posts p
              CROSS JOIN LATERAL ( SELECT x.play,
                     x.reply
                    FROM post_under x
                   WHERE ((x.parent = p.id) AND (NOT card_ended(x.play)))) u)
              JOIN acts_public a ON ((a.id = u.reply)))
         ), posts AS MATERIALIZED (
          SELECT p.id,
             p."character",
             p.created_at
            FROM page_posts p
         UNION ALL
          SELECT n.id,
             n."character",
             n.created_at
            FROM nested n
         ), on_posts AS MATERIALIZED (
          SELECT l.id,
             l."character",
             l.kind,
             l.thread,
             l.target_act_id,
             l.seq,
             l.created_at,
             l.payload,
             l.current_payload,
             l.edited_at,
             l.shown_edited_at,
             l.untaken,
             l.ends_at,
             l.hidden,
             l.any_hidden,
             l.concealing,
             l.payload_hidden,
             l.payload_concealing,
             l.n
            FROM ( SELECT a.id,
                     a."character",
                     a.kind,
                     a.thread,
                     a.target_act_id,
                     a.seq,
                     a.created_at,
                     a.payload,
                     a.current_payload,
                     a.edited_at,
                     a.shown_edited_at,
                     a.untaken,
                     a.ends_at,
                     a.hidden,
                     a.any_hidden,
                     a.concealing,
                     a.payload_hidden,
                     a.payload_concealing,
                     row_number() OVER (PARTITION BY a.target_act_id ORDER BY a.created_at, a.id) AS n
                    FROM acts_public a
                   WHERE ((a.kind = ANY (ARRAY['card'::text, 'set'::text, 'spring'::text])) AND (a.target_act_id IN ( SELECT p.id
                            FROM posts p)))) l
           WHERE (l.n <= 8)
         ), ends_on_posts AS MATERIALIZED (
          SELECT a.id,
             a."character",
             a.kind,
             a.thread,
             a.target_act_id,
             a.seq,
             a.created_at,
             a.payload,
             a.current_payload,
             a.edited_at,
             a.shown_edited_at,
             a.untaken,
             a.ends_at,
             a.hidden,
             a.any_hidden,
             a.concealing,
             a.payload_hidden,
             a.payload_concealing
            FROM acts_public a
           WHERE ((a.kind = 'card_end'::text) AND (a.target_act_id IN ( SELECT o.id
                    FROM on_posts o)))
         ), above AS MATERIALIZED (
          SELECT x.play,
             x.reach,
             x.target,
             x.ends_at,
             x.act
            FROM effects_above(ARRAY( SELECT DISTINCT p."character"
                    FROM posts p
                   WHERE (p."character" IS NOT NULL)), ( SELECT rng.id
                    FROM rng), ( SELECT rng.board
                    FROM rng)) x(play, reach, target, ends_at, act)
         ), kept_span AS MATERIALIZED (
          SELECT min(p.created_at) AS lo,
             max(p.created_at) AS hi
            FROM posts p
         ), kept_reach AS MATERIALIZED (
          SELECT x.play,
             x.reach,
             COALESCE(x."character", x.thread, x.board) AS target,
             x.ends_at
            FROM play_reach x,
             kept_span s
           WHERE ((s.lo IS NOT NULL) AND (x.thread = ( SELECT rng.id
                    FROM rng)) AND (tstzrange(x.started_at, x.ends_at) && tstzrange(s.lo, s.hi, '[]'::text)) AND (x.ends_at <= now()))
         UNION ALL
          SELECT x.play,
             x.reach,
             x."character" AS target,
             x.ends_at
            FROM ((( SELECT DISTINCT p."character"
                    FROM posts p
                   WHERE (p."character" IS NOT NULL)) au
              CROSS JOIN kept_span s)
              CROSS JOIN LATERAL ( SELECT r.play,
                     r.reach,
                     r."character",
                     r.ends_at
                    FROM play_reach r
                   WHERE ((r."character" = au."character") AND (tstzrange(r.started_at, r.ends_at) && tstzrange(s.lo, s.hi, '[]'::text)) AND (r.ends_at <= now()))) x)
         ), kept_window AS MATERIALIZED (
          SELECT r.play,
             r.reach,
             r.target,
             r.ends_at,
             a.created_at AS started,
             to_jsonb(a.*) AS act,
             (a.payload ->> 'card'::text) AS card
            FROM (kept_reach r
              JOIN acts_public a ON ((a.id = r.play))),
             kept_span s
           WHERE ((a.created_at <= s.hi) AND (EXISTS ( SELECT 1
                    FROM posts p
                   WHERE ((a.created_at <= p.created_at) AND (p.created_at < r.ends_at) AND ((r.reach <> 'character'::text) OR (p."character" = r.target))))))
         ), kept AS MATERIALIZED (
          SELECT w.play,
             w.reach,
             w.target,
             w.ends_at,
             w.act
            FROM (kept_window w
              JOIN card_kinds ck ON (((ck.key = w.card) AND ck.keeps)))
           WHERE (NOT card_ended(w.play))
           ORDER BY w.started, w.play
          LIMIT 100
         ), played AS MATERIALIZED (
          SELECT o.id,
             o.kind,
             o."character",
             (o.payload ->> 'card'::text) AS card
            FROM on_posts o
         UNION
          SELECT ((x.act ->> 'id'::text))::uuid AS uuid,
             (x.act ->> 'kind'::text),
             ((x.act ->> 'character'::text))::uuid AS uuid,
             ((x.act -> 'payload'::text) ->> 'card'::text)
            FROM above x
         UNION
          SELECT ((x.act ->> 'id'::text))::uuid AS uuid,
             (x.act ->> 'kind'::text),
             ((x.act ->> 'character'::text))::uuid AS uuid,
             ((x.act -> 'payload'::text) ->> 'card'::text)
            FROM kept x
         ), vis AS MATERIALIZED (
          SELECT DISTINCT ON (v.target_act_id) v.id,
             v.target_act_id AS post,
             v."character",
             v.created_at,
             v.payload
            FROM acts_public v
           WHERE ((v.kind = 'visit'::text) AND (v.target_act_id IN ( SELECT a.id
                    FROM page_acts a
                   WHERE (a.kind = ANY (ARRAY['post'::text, 'spin'::text]))
                 UNION ALL
                  SELECT n.id
                    FROM nested n)))
           ORDER BY v.target_act_id, v.created_at DESC, v.id DESC
         ), o_on AS MATERIALIZED (
          SELECT r.origin_act_id AS id
            FROM rng r
           WHERE ((r.origin_act_id IS NOT NULL) AND (EXISTS ( SELECT 1
                    FROM page_acts a
                   WHERE (a.id = r.first_act))))
         ), o_act AS MATERIALIZED (
          SELECT a.*
            FROM (o_on o
              JOIN acts_public a ON ((a.id = o.id)))
         ), o_plays AS MATERIALIZED (
          SELECT x.*
            FROM (o_on o
              CROSS JOIN LATERAL ( SELECT a.*
                    FROM acts_public a
                   WHERE ((a.kind = ANY (ARRAY['card'::text, 'set'::text, 'spring'::text])) AND (a.target_act_id = o.id))
                   ORDER BY a.created_at, a.id
                  LIMIT 21) x)
         ), o_shown AS MATERIALIZED (
          SELECT s.*
            FROM o_plays s
           ORDER BY s.created_at, s.id
          LIMIT 20
         ), o_ends AS MATERIALIZED (
          SELECT e.*
            FROM acts_public e
           WHERE ((e.kind = 'card_end'::text) AND (e.target_act_id IN ( SELECT s.id
                    FROM o_shown s)))
         ), o_cast AS MATERIALIZED (
          SELECT w.c
            FROM ( SELECT a."character" AS c
                    FROM o_act a
                 UNION
                  SELECT s."character"
                    FROM o_shown s
                 UNION
                  SELECT
                         CASE
                             WHEN ((a.kind = ANY (ARRAY['card'::text, 'set'::text, 'spring'::text])) AND ((a.payload ->> 'reach'::text) = 'character'::text)) THEN ((a.payload ->> 'character'::text))::uuid
                             ELSE NULL::uuid
                         END AS "character"
                    FROM o_act a) w
           WHERE (w.c IS NOT NULL)
         ), o_post AS MATERIALIZED (
          SELECT x.id
            FROM ( SELECT
                         CASE
                             WHEN post_kind(a.kind) THEN a.id
                             WHEN (a.kind = 'poll'::text) THEN a.target_act_id
                             WHEN (a.kind = 'ballot'::text) THEN ( SELECT q.target_act_id
                                FROM acts_public q
                               WHERE (q.id = a.target_act_id))
                             ELSE NULL::uuid
                         END AS id
                    FROM o_act a) x
           WHERE (x.id IS NOT NULL)
         ), pl_post AS MATERIALIZED (
          SELECT p.id
            FROM posts p
         UNION
          SELECT o.id
            FROM o_post o
         ), pl_cur AS MATERIALIZED (
          SELECT x.id AS post,
             l.id AS poll,
             l.created_at,
             ((l.payload ->> 'secret'::text))::boolean AS secret,
             to_jsonb(l.*) AS act
            FROM (pl_post x
              CROSS JOIN LATERAL ( SELECT a.*
                    FROM acts_public a
                   WHERE ((a.kind = 'poll'::text) AND (a.target_act_id = x.id))
                   ORDER BY a.created_at DESC, a.id DESC
                  LIMIT 1) l)
           WHERE (NOT (l.payload ? 'removed'::text))
         ), pl_polls AS MATERIALIZED (
          SELECT c.post,
             c.poll,
             c.created_at,
             c.secret,
             c.act,
             k.counts,
             k.voters,
             k.ends_at,
             k.closed,
             cl.j AS close,
             EXISTS (SELECT 1 FROM acts b WHERE b.kind = 'ballot'::text AND b.target_act_id = c.poll) AS balloted
            FROM ((pl_cur c
              CROSS JOIN LATERAL ( SELECT n.counts,
                     n.voters,
                     n.ends_at,
                     n.closed
                    FROM poll_counts n
                   WHERE (n.poll = c.poll)) k)
              LEFT JOIN LATERAL ( SELECT to_jsonb(e.*) AS j
                    FROM acts_public e
                   WHERE ((e.kind = 'poll_close'::text) AND (e.target_act_id = c.poll))
                  LIMIT 1) cl ON (true))
         ), pl_voters AS MATERIALIZED (
          SELECT p.post,
             p.poll,
             b.id AS act,
             b."character",
             (b.payload -> 'picks'::text) AS picks,
             b.created_at
            FROM ((pl_polls p
              CROSS JOIN LATERAL poll_voter_acts(p.poll, p.ends_at, 50) v(act))
              CROSS JOIN LATERAL ( SELECT x.id,
                     x."character",
                     x.payload,
                     x.created_at
                    FROM acts_public x
                   WHERE (x.id = v.act)) b)
           WHERE (NOT p.secret)
         ), pl_cast AS MATERIALIZED (
          SELECT DISTINCT v."character" AS c
            FROM pl_voters v
           WHERE (v."character" IS NOT NULL)
         ), pl_mine AS MATERIALIZED (
          SELECT m.act,
             m.poll,
             p.post,
             m."character",
             m.picks,
             m.created_at
            FROM (my_latest_ballots m
              JOIN pl_polls p ON ((p.poll = m.poll)))
           WHERE (m.created_at < p.ends_at)
         UNION ALL
          SELECT b.act,
             l.poll,
             p.post,
             l."character",
             b.picks,
             b.created_at
            FROM ((my_latest_ballots l
              JOIN pl_polls p ON ((p.poll = l.poll)))
              CROSS JOIN LATERAL ( SELECT m.act,
                     m.picks,
                     m.created_at
                    FROM my_ballots m
                   WHERE ((m.poll = l.poll) AND (m."character" = l."character") AND (m.created_at < p.ends_at))
                   ORDER BY m.created_at DESC, m.act DESC
                  LIMIT 1) b)
           WHERE (l.created_at >= p.ends_at)
         ), ids AS MATERIALIZED (
          SELECT a.id
            FROM page_acts a
         UNION
          SELECT n.id
            FROM nested n
         UNION
          SELECT p.id
            FROM played p
         UNION
          SELECT a.id
            FROM o_act a
         UNION
          SELECT s.id
            FROM o_shown s
         UNION
          SELECT p.poll
            FROM pl_polls p
         ), who AS MATERIALIZED (
          SELECT w.c
            FROM ( SELECT a."character" AS c
                    FROM page_acts a
                 UNION
                  SELECT n."character"
                    FROM nested n
                 UNION
                  SELECT p."character"
                    FROM played p
                 UNION
                  SELECT v."character"
                    FROM vis v) w
           WHERE (w.c IS NOT NULL)
         ), wanted_plays AS MATERIALIZED (
          SELECT p.id
            FROM played p
           WHERE (p.card = ANY (COALESCE(thread_page.effect_cards, '{}'::text[])))
         UNION
          SELECT s.id
            FROM o_shown s
           WHERE ((s.payload ->> 'card'::text) = ANY (COALESCE(thread_page.effect_cards, '{}'::text[])))
         ), heads AS MATERIALIZED (
          SELECT c.id,
             jsonb_build_object('character', jsonb_build_object('id', c.id, 'name', c.name, 'joined', c.joined, 'staff', c.staff, 'office', c.office, 'warn_points', c.warn_points, 'banned_until', c.banned_until, 'group', c."group"), 'profile', ( SELECT (jsonb_build_object('character', p."character", 'title', p.title, 'signature', p.signature, 'avatar_square', p.avatar_square, 'avatar_portrait', p.avatar_portrait, 'square_frame', p.square_frame, 'portrait_frame', p.portrait_frame, 'pip_style', p.pip_style, 'pronouns', p.pronouns) || profile_cosmetics(p."character"))
                    FROM character_profiles p
                   WHERE (p."character" = c.id))) AS head
            FROM (( SELECT w.c
                    FROM who w
                 UNION
                  SELECT o.c
                    FROM o_cast o
                 UNION
                  SELECT v.c
                    FROM pl_cast v) k(id)
              CROSS JOIN LATERAL ( SELECT x.*
                    FROM characters_public x
                   WHERE (x.id = k.id)
                  OFFSET 0) c)
         ), spun AS MATERIALIZED (
          SELECT l.id,
             l.board,
             l.title,
             l.origin_act_id,
             l.created_at,
             l.last_at,
             l.last_seq,
             l.replies,
             l.first_act,
             l.first_character,
             l.last_act,
             l.last_character,
             l.replies_this_week,
             l.origin_thread,
             l.origin_place,
             l.n
            FROM ( SELECT t.id,
                     t.board,
                     t.title,
                     t.origin_act_id,
                     t.created_at,
                     t.last_at,
                     t.last_seq,
                     t.replies,
                     t.first_act,
                     t.first_character,
                     t.last_act,
                     t.last_character,
                     t.replies_this_week,
                     t.origin_thread,
                     t.origin_place,
                     row_number() OVER (PARTITION BY t.origin_act_id ORDER BY t.created_at, t.id) AS n
                    FROM thread_list t
                   WHERE (t.origin_act_id IN ( SELECT i.id
                            FROM ids i))) l
           WHERE (l.n <= 200)
         )
  SELECT
         CASE
             WHEN (NOT (EXISTS ( SELECT 1
                FROM rng))) THEN NULL::jsonb
             ELSE jsonb_build_object('summary', ( SELECT (to_jsonb(s.*) - 'last_page'::text)
                FROM s), 'page', ( SELECT rng.page
                FROM rng), 'acts', ( SELECT COALESCE(jsonb_agg(to_jsonb(a.*) ORDER BY a.seq), '[]'::jsonb) AS "coalesce"
                FROM page_acts a), 'people', ( SELECT COALESCE(jsonb_agg((c.head || jsonb_build_object('posts', COALESCE(( SELECT n.posts
                        FROM character_post_counts n
                       WHERE (n."character" = c.id)), 0), 'standing', COALESCE(( SELECT st.standing
                        FROM current_standings st
                       WHERE (st."character" = c.id)), 0), 'reveals', ( SELECT COALESCE(jsonb_agg(jsonb_build_object('act', r.act, 'character', r."character", 'class', r.class, 'at', r.at, 'via', r.via, 'thread', r.thread) ORDER BY r.at, r.act), '[]'::jsonb) AS "coalesce"
                        FROM class_reveals r
                       WHERE (r."character" = c.id)), 'turns', ( SELECT COALESCE(jsonb_agg(jsonb_build_object('act', u.act, 'character', u."character", 'at', u.at, 'was', u.was) ORDER BY u.at, u.act), '[]'::jsonb) AS "coalesce"
                        FROM turns_announced u
                       WHERE (u."character" = c.id)))) ORDER BY c.id), '[]'::jsonb) AS "coalesce"
                FROM heads c
               WHERE (c.id IN ( SELECT w.c
                        FROM who w))), 'plays', ( SELECT COALESCE(jsonb_agg(x.j ORDER BY x.created_at, x.id), '[]'::jsonb) AS "coalesce"
                FROM ( SELECT (to_jsonb(o.*) - 'n'::text) AS j,
                         o.created_at,
                         o.id
                        FROM on_posts o
                     UNION ALL
                      SELECT to_jsonb(e.*) AS to_jsonb,
                         e.created_at,
                         e.id
                        FROM ends_on_posts e) x), 'above', ( SELECT COALESCE(jsonb_agg(jsonb_build_object('play', x.play, 'reach', x.reach, 'target', x.target, 'ends_at', x.ends_at, 'act', x.act) ORDER BY ((x.act ->> 'created_at'::text))::timestamp with time zone, x.play), '[]'::jsonb) AS "coalesce"
                FROM above x), 'kept', ( SELECT COALESCE(jsonb_agg(jsonb_build_object('play', x.play, 'reach', x.reach, 'target', x.target, 'ends_at', x.ends_at, 'act', x.act) ORDER BY ((x.act ->> 'created_at'::text))::timestamp with time zone, x.play), '[]'::jsonb) AS "coalesce"
                FROM kept x), 'under', ( SELECT COALESCE(jsonb_agg(jsonb_build_object('parent', n.parent, 'play', n.play, 'act', n.act) ORDER BY ((n.act ->> 'seq'::text))::integer, n.id), '[]'::jsonb) AS "coalesce"
                FROM nested n), 'cut', ( SELECT COALESCE(jsonb_agg(jsonb_build_object('seq', d.seq, 'parent_seq', ( SELECT pa.seq
                        FROM acts_public pa
                       WHERE (pa.id = d.parent))) ORDER BY d.seq), '[]'::jsonb) AS "coalesce"
                FROM drawn d
               WHERE (d.kind = 'post'::text)), 'visits', ( SELECT COALESCE(jsonb_agg(jsonb_build_object('visit', v.id, 'post', v.post, 'mod', v."character", 'at', v.created_at, 'ends_at', (v.payload -> 'ends_at'::text), 'line', (v.payload -> 'line'::text), 'charges', ((v.payload -> 'charges'::text) || COALESCE(( SELECT jsonb_agg((j.payload -> 'charge'::text) ORDER BY j.created_at, j.id) AS jsonb_agg
                        FROM acts_public j
                       WHERE ((j.kind = 'visit_join'::text) AND (j.target_act_id = v.id))), '[]'::jsonb)), 'challenge', (jsonb_strip_nulls(jsonb_build_object('kind', (v.payload #>> '{challenge,kind}'::text[]), 'question_index', (v.payload #> '{challenge,question_index}'::text[]), 'price', (v.payload #> '{challenge,price}'::text[]))) || COALESCE(visit_quiz(v.id), '{}'::jsonb)), 'end', ( SELECT jsonb_build_object('act', e.id, 'at', e.created_at, 'outcome', (e.payload ->> 'outcome'::text), 'by_act', (e.payload -> 'by_act'::text), 'line', (e.payload -> 'line'::text)) AS jsonb_build_object
                        FROM acts_public e
                       WHERE ((e.kind = 'visit_end'::text) AND (e.target_act_id = v.id))
                      LIMIT 1), 'ruling', ( SELECT (r.payload ->> 'verdict'::text)
                        FROM ((acts_public i
                          JOIN acts_public ap ON (((ap.kind = 'appeal'::text) AND (ap.target_act_id = i.id))))
                          JOIN acts_public r ON (((r.kind = 'appeal_ruling'::text) AND (r.target_act_id = ap.id))))
                       WHERE ((i.kind = 'infraction'::text) AND ((i.payload ->> 'visit_act'::text) = (v.id)::text))
                      LIMIT 1)) ORDER BY v.created_at, v.id), '[]'::jsonb) AS "coalesce"
                FROM vis v), 'faces', ( SELECT COALESCE(jsonb_agg(jsonb_build_object('play', f.play, 'card', f.card)), '[]'::jsonb) AS "coalesce"
                FROM my_face_down f
               WHERE (f.play IN ( SELECT p.id
                        FROM played p
                       WHERE (p.kind = 'set'::text)))), 'veiled', ( SELECT COALESCE(jsonb_agg(jsonb_build_object('post', v.post, 'character', v."character", 'play', v.play, 'ends_at', v.ends_at) ORDER BY v.post), '[]'::jsonb) AS "coalesce"
                FROM my_veiled_posts v
               WHERE (v.post IN ( SELECT p.id
                        FROM posts p))), 'states', ( SELECT COALESCE(jsonb_agg(jsonb_build_object('play', e.play, 'state', e.state, 'saved_at', e.saved_at)), '[]'::jsonb) AS "coalesce"
                FROM effect_state e
               WHERE (e.play IN ( SELECT w.id
                        FROM wanted_plays w))), 'releases', ( SELECT COALESCE(jsonb_agg(r.play), '[]'::jsonb) AS "coalesce"
                FROM effect_releases r
               WHERE (r.play IN ( SELECT w.id
                        FROM wanted_plays w))), 'spent', ( SELECT COALESCE(jsonb_agg(o.id ORDER BY o.created_at, o.id), '[]'::jsonb) AS "coalesce"
                FROM (on_posts o
                  JOIN card_kinds ck ON (((ck.key = (o.payload ->> 'card'::text)) AND ((ck.discipline ->> 'kind'::text) = 'fall'::text))))
               WHERE ((o.kind = 'card'::text) AND fall_spent(o.id))), 'surfaces', ( SELECT COALESCE(jsonb_object_agg((sf.play)::text, jsonb_build_object('covered', bit_count(sf.cover), 'live', to_jsonb(sf.live))), '{}'::jsonb) AS "coalesce"
                FROM surfaces sf
               WHERE (sf.play IN ( SELECT o.id
                        FROM on_posts o
                       WHERE (o.kind = 'card'::text)))), 'tallies', ( SELECT COALESCE(jsonb_agg(jsonb_build_object('act', t.act, 'kind', t.kind, 'count', t.count)), '[]'::jsonb) AS "coalesce"
                FROM reaction_tallies t
               WHERE (t.act IN ( SELECT i.id
                        FROM ids i))), 'mine', ( SELECT COALESCE(jsonb_agg(jsonb_build_object('act', m.act, 'kind', m.kind, 'character', m."character")), '[]'::jsonb) AS "coalesce"
                FROM my_reactions m
               WHERE (m.act IN ( SELECT i.id
                        FROM ids i))), 'polls', ( SELECT COALESCE(jsonb_agg(jsonb_build_object('post', p.post, 'act', p.act, 'counts', to_jsonb(p.counts), 'voters', p.voters, 'ends_at', p.ends_at, 'closed', p.closed, 'close', p.close, 'balloted', p.balloted) ORDER BY p.created_at, p.poll), '[]'::jsonb) AS "coalesce"
                FROM pl_polls p), 'voters', ( SELECT COALESCE(jsonb_agg(jsonb_build_object('poll', v.poll, 'act', v.act, 'character', v."character", 'picks', v.picks, 'at', v.created_at) ORDER BY v.poll, v.created_at DESC, v.act DESC), '[]'::jsonb) AS "coalesce"
                FROM pl_voters v), 'votersMore', ( SELECT COALESCE(jsonb_agg(p.poll ORDER BY p.created_at, p.poll), '[]'::jsonb) AS "coalesce"
                FROM pl_polls p
               WHERE ((NOT p.secret) AND (p.voters > 50))), 'voterCast', ( SELECT COALESCE(jsonb_agg(h.head ORDER BY h.id), '[]'::jsonb) AS "coalesce"
                FROM heads h
               WHERE (h.id IN ( SELECT v.c
                        FROM pl_cast v))), 'myBallots', ( SELECT COALESCE(jsonb_agg(jsonb_build_object('act', m.act, 'poll', m.poll, 'character', m."character", 'picks', m.picks, 'at', m.created_at) ORDER BY m.created_at, m.act), '[]'::jsonb) AS "coalesce"
                FROM pl_mine m), 'spun', ( SELECT COALESCE(jsonb_agg((to_jsonb(l.*) - 'n'::text) ORDER BY l.created_at, l.id), '[]'::jsonb) AS "coalesce"
                FROM spun l), 'reading', ( SELECT r.furthest_seq
                FROM reading r
               WHERE (r.thread = thread_page.in_thread)
              LIMIT 1), 'board', ( SELECT jsonb_build_object('id', b.id, 'slug', b.slug, 'name', b.name, 'description', b.description, 'is_system', b.is_system, 'move_act', b.move_act) AS jsonb_build_object
                FROM boards_now b
               WHERE (b.id = ( SELECT rng.board
                        FROM rng))), 'following', following_thread(in_thread), 'presence', presence_box('thread'::text, in_thread), 'unread', my_alerts_unread()) ||
             CASE
                 WHEN (EXISTS ( SELECT 1
                    FROM o_on)) THEN jsonb_build_object('origin', jsonb_build_object('act', ( SELECT to_jsonb(a.*) AS to_jsonb
                        FROM o_act a), 'plays', ( SELECT COALESCE(jsonb_agg(x.j ORDER BY x.grp, x.created_at, x.id), '[]'::jsonb) AS "coalesce"
                        FROM ( SELECT to_jsonb(s.*) AS j,
                                 0 AS grp,
                                 s.created_at,
                                 s.id
                                FROM o_shown s
                             UNION ALL
                              SELECT to_jsonb(e.*) AS to_jsonb,
                                 1,
                                 e.created_at,
                                 e.id
                                FROM o_ends e) x), 'more', ((( SELECT count(*) AS count
                        FROM o_plays)) > 20), 'moment', origin_moment(in_thread), 'at', ( SELECT jsonb_build_object('thread', (z.q ->> 'thread'::text), 'seq', ((z.q ->> 'seq'::text))::integer) AS jsonb_build_object
                        FROM ( SELECT
                                 CASE
                                     WHEN ((r.origin_place ->> 'kind'::text) = 'play'::text) THEN COALESCE(NULLIF((r.origin_place -> 'at'::text), 'null'::jsonb),
                                     CASE
                                         WHEN ((r.origin_place #>> '{on,kind}'::text[]) = 'post'::text) THEN (r.origin_place -> 'on'::text)
                                         ELSE NULLIF((r.origin_place -> 'from'::text), 'null'::jsonb)
                                     END)
                                     WHEN ((r.origin_place ->> 'kind'::text) = ANY (ARRAY['poll'::text, 'ballot'::text])) THEN (r.origin_place -> 'on'::text)
                                     ELSE NULL::jsonb
                                 END AS q
                                FROM rng r) z
                       WHERE (jsonb_typeof(z.q) = 'object'::text)), 'cast', ( SELECT COALESCE(jsonb_agg(h.head ORDER BY h.id), '[]'::jsonb) AS "coalesce"
                        FROM heads h
                       WHERE (h.id IN ( SELECT o.c
                                FROM o_cast o
                             UNION
                              SELECT v."character"
                                FROM pl_voters v
                               WHERE ((v.post IN ( SELECT op.id
                                        FROM o_post op)) AND (EXISTS ( SELECT 1
                                        FROM o_act a
                                       WHERE (a.kind = ANY (ARRAY['poll'::text, 'ballot'::text]))))))))) ||
                     CASE
                         WHEN (EXISTS ( SELECT 1
                            FROM o_act a
                           WHERE (a.kind = ANY (ARRAY['poll'::text, 'ballot'::text])))) THEN jsonb_build_object('polls', ( SELECT COALESCE(jsonb_agg(jsonb_build_object('post', p.post, 'act', p.act, 'counts', to_jsonb(p.counts), 'voters', p.voters, 'ends_at', p.ends_at, 'closed', p.closed, 'close', p.close, 'balloted', p.balloted) ORDER BY p.created_at, p.poll), '[]'::jsonb) AS "coalesce"
                            FROM pl_polls p
                           WHERE (p.post IN ( SELECT op.id
                                    FROM o_post op))), 'voters', ( SELECT COALESCE(jsonb_agg(jsonb_build_object('poll', v.poll, 'act', v.act, 'character', v."character", 'picks', v.picks, 'at', v.created_at) ORDER BY v.poll, v.created_at DESC, v.act DESC), '[]'::jsonb) AS "coalesce"
                            FROM pl_voters v
                           WHERE (v.post IN ( SELECT op.id
                                    FROM o_post op))), 'votersMore', ( SELECT COALESCE(jsonb_agg(p.poll ORDER BY p.created_at, p.poll), '[]'::jsonb) AS "coalesce"
                            FROM pl_polls p
                           WHERE ((NOT p.secret) AND (p.voters > 50) AND (p.post IN ( SELECT op.id
                                    FROM o_post op)))), 'myBallots', ( SELECT COALESCE(jsonb_agg(jsonb_build_object('act', m.act, 'poll', m.poll, 'character', m."character", 'picks', m.picks, 'at', m.created_at) ORDER BY m.created_at, m.act), '[]'::jsonb) AS "coalesce"
                            FROM pl_mine m
                           WHERE (m.post IN ( SELECT op.id
                                    FROM o_post op))))
                         ELSE '{}'::jsonb
                     END)
                 ELSE '{}'::jsonb
             END
         END AS jsonb_build_object
  );
end
$function$;

revoke execute on function public.thread_page(uuid, integer, integer, integer, text[]) from public, anon, authenticated, service_role;
grant execute on function public.thread_page(uuid, integer, integer, integer, text[]) to authenticated, service_role;

-- ===================================================================================== 4. log_page ====
-- log_page (0385_crowd_log.sql), also holding the caller's own ballots and an admin's closes of the caller's polls as the sources `ballots` and `pollCloses`. Everything else as 0385 wrote it (the crowd pay's source included).
create or replace function public.log_page(in_before timestamp with time zone)
 returns jsonb
 language plpgsql
 stable
 set search_path to 'public', 'pg_temp'
 set plan_cache_mode = force_generic_plan
 set jit = off
as $function$
#variable_conflict use_column
begin
  return (
  WITH RECURSIVE mine AS (
          SELECT m.id,
             m.class_since
            FROM my_characters m
         ), lg AS MATERIALIZED (
          SELECT l.settlement,
             l.starts_at,
             l.ends_at,
             l."character",
             l.reason,
             l.amount,
             l.shares_kept,
             l.params
            FROM my_ledger l
           WHERE (l.ends_at <= COALESCE(log_page.in_before, 'infinity'::timestamp with time zone))
           ORDER BY l.ends_at DESC, l.settlement, l."character", l.reason
          LIMIT 200
         ), wl AS MATERIALIZED (
          SELECT e.settlement,
             e.kind,
             e.change,
             e.overflow,
             e.floored,
             e.balance_after,
             e.ref,
             e.at
            FROM my_wallet_events e
           WHERE (e.at <= COALESCE(log_page.in_before, 'infinity'::timestamp with time zone))
           ORDER BY e.at DESC, e.settlement, e.kind, e.ref, e.change, e.overflow, e.floored, e.balance_after
          LIMIT 200
         ), cd AS MATERIALIZED (
          SELECT c.card,
             c.kind,
             c.act,
             c.price,
             c.at,
             c.springs,
             c.pack,
             c.repriced,
             c.pack_kind,
             c.pack_source
            FROM my_card_ledger c
           WHERE (c.at <= COALESCE(log_page.in_before, 'infinity'::timestamp with time zone))
           ORDER BY c.at DESC, c.card, c.kind, c.act, c.price, c.pack
          LIMIT 200
         ), pk AS MATERIALIZED (
          SELECT p.id,
             p.pack,
             p.price,
             p.repriced,
             p.contents,
             p.bought_at,
             p.source
            FROM my_packs p
           WHERE (p.bought_at <= COALESCE(log_page.in_before, 'infinity'::timestamp with time zone))
           ORDER BY p.bought_at DESC, p.id
          LIMIT 200
         ), po AS MATERIALIZED (
          SELECT p.play,
             p.post,
             p.at,
             p.reach,
             p.target_name,
             p.target_character
            FROM my_posts_played_on p
           WHERE (p.at <= COALESCE(log_page.in_before, 'infinity'::timestamp with time zone))
           ORDER BY p.at DESC, p.play
          LIMIT 200
         ), wr AS MATERIALIZED (
          SELECT w.play,
             w.post,
             w.version,
             w.failed,
             w.opening,
             w.over,
             w.at
            FROM my_posts_written_on w
           WHERE (w.at <= COALESCE(log_page.in_before, 'infinity'::timestamp with time zone))
           ORDER BY w.at DESC, w.play, w.version
          LIMIT 200
         ), dr AS MATERIALIZED (
          SELECT r.act,
             r.kind,
             r.play,
             r.post,
             r."character",
             r.mine,
             r.at,
             r.cells
            FROM my_draws r
           WHERE (r.at <= COALESCE(log_page.in_before, 'infinity'::timestamp with time zone))
           ORDER BY r.at DESC, r.act, r.mine
          LIMIT 200
         ), wd AS MATERIALIZED (
          SELECT r.act,
             r.kind,
             r.play,
             r.post,
             r."character",
             r.mine,
             r.at,
             r.cells
            FROM my_walls_drawn_on r
           WHERE (r.at <= COALESCE(log_page.in_before, 'infinity'::timestamp with time zone))
           ORDER BY r.at DESC, r.act, r.mine
          LIMIT 200
         ), sv AS MATERIALIZED (
          SELECT p.play,
             p.post,
             p.saved_at
            FROM my_posts_played_on p
           WHERE ((p.saved_at IS NOT NULL) AND (p.saved_at <= COALESCE(log_page.in_before, 'infinity'::timestamp with time zone)))
           ORDER BY p.saved_at DESC, p.play
          LIMIT 200
         ), se AS MATERIALIZED (
          SELECT f.play,
             f.card,
             f.post,
             f.spring,
             f.ended_at,
             f.ended_by
            FROM my_face_down f
           WHERE ((f.ended_at IS NOT NULL) AND (f.ended_at <= COALESCE(log_page.in_before, 'infinity'::timestamp with time zone)))
           ORDER BY f.ended_at DESC, f.play
          LIMIT 200
         ), sp AS MATERIALIZED (
          SELECT f.play,
             f.card,
             f.post,
             f.ends_at,
             f.passed_at
            FROM my_face_down f
           WHERE ((f.passed_at IS NOT NULL) AND (f.spring IS NULL) AND (f.passed_at <= COALESCE(log_page.in_before, 'infinity'::timestamp with time zone)))
           ORDER BY f.passed_at DESC, f.play
          LIMIT 200
         ), ca AS MATERIALIZED (
          SELECT c.play,
             c.card,
             c.post,
             c.trap,
             c.spring,
             c.price,
             c.at
            FROM my_caught c
           WHERE (c.at <= COALESCE(log_page.in_before, 'infinity'::timestamp with time zone))
           ORDER BY c.at DESC, c.play
          LIMIT 200
         ), en AS MATERIALIZED (
          SELECT e.card_end,
             e.play,
             e.card,
             e.at,
             e.side,
             e.reach,
             e.target_name,
             e.post_author_name,
             e.caster_name,
             e."character"
            FROM my_cards_ended e
           WHERE (e.at <= COALESCE(log_page.in_before, 'infinity'::timestamp with time zone))
           ORDER BY e.at DESC, e.card_end
          LIMIT 200
         ), inf AS MATERIALIZED (
          SELECT i.infraction,
             i."character",
             i.at,
             i.band,
             i.points,
             i.rule_number,
             i.rule,
             i.mod_name,
             i.post,
             i.post_seq,
             i.thread,
             i.expires_at,
             i.relief,
             i.emptied_at,
             i.card_relief,
             i.fall_play
            FROM my_infractions i
           WHERE (i.at <= COALESCE(log_page.in_before, 'infinity'::timestamp with time zone))
           ORDER BY i.at DESC, i.infraction
          LIMIT 200
         ), bn AS MATERIALIZED (
          SELECT b.ban,
             b."character",
             b.at,
             b.days,
             b.until,
             b.infraction,
             b.rule,
             b.thread,
             b.ruling,
             b.own_until,
             b.lifted_at,
             b.lifted_card
            FROM my_bans b
           WHERE (b.at <= COALESCE(log_page.in_before, 'infinity'::timestamp with time zone))
           ORDER BY b.at DESC, b.ban
          LIMIT 200
         ), fl AS MATERIALIZED (
          SELECT f.infraction,
             f."character",
             f.at,
             f.post,
             f.post_seq,
             f.thread,
             f.rule,
             f.points,
             f.mod_name,
             f.taker_name
            FROM my_falls_taken f
           WHERE (f.at <= COALESCE(log_page.in_before, 'infinity'::timestamp with time zone))
           ORDER BY f.at DESC, f.infraction
          LIMIT 200
         ), gm AS MATERIALIZED (
          SELECT g.move,
             g."character",
             g.at,
             g.thread,
             g.seq,
             g."group",
             g.board,
             g.board_name,
             g.expires_at,
             g.landed_until,
             g.check_at,
             g.demand,
             g.office,
             g.ended_why,
             g.ended_by,
             g.ended_at,
             g.ruling,
             g.ruled_at,
             g.ruled_until,
             g.ruled_office
            FROM my_group_moves g
           WHERE (g.at <= COALESCE(log_page.in_before, 'infinity'::timestamp with time zone))
           ORDER BY g.at DESC, g.move
          LIMIT 200
         ), rp AS MATERIALIZED (
          SELECT r.report,
             r."character",
             r.at,
             r.post,
             r.post_seq,
             r.thread,
             r.verdict,
             r.verdict_at,
             r.mod_name,
             r.refund
            FROM my_reports r
           WHERE (r.at <= COALESCE(log_page.in_before, 'infinity'::timestamp with time zone))
           ORDER BY r.at DESC, r.report
          LIMIT 200
         ), ap AS MATERIALIZED (
          SELECT a.appeal,
             a."character",
             a.at,
             a.punishment,
             a.punishment_kind,
             a.post_seq,
             a.thread,
             a.verdict,
             a.ruled_at,
             a.points_delta,
             a.hearer_name,
             a.refund
            FROM my_appeals a
           WHERE (a.at <= COALESCE(log_page.in_before, 'infinity'::timestamp with time zone))
           ORDER BY a.at DESC, a.appeal
          LIMIT 200
         ), cs AS MATERIALIZED (
          SELECT c.kind,
             c.id,
             c.at,
             c."character",
             c.outcome,
             c.item,
             c.text,
             c.copies,
             c.trophy,
             c.name,
             c.by,
             c.by_name,
             c.season,
             c.place,
             c.line,
             c.to_name
            FROM cosmetic_log_rows(log_page.in_before, 200) c(kind, id, at, "character", outcome, item, text, copies, trophy, name, by, by_name, season, place, line, to_name)
           ORDER BY c.at DESC, c.kind, c.id
         ), sh AS MATERIALIZED (
          SELECT s.settlement,
             s."character",
             s.reason,
             s.act,
             s.quadrant,
             s.amount,
             s.card
            FROM my_ledger_shares s
           WHERE (s.settlement IN ( SELECT x.settlement
                    FROM lg x))
         ), cp AS MATERIALIZED (
          -- The caller's own crowd rows for the settlements the wallet rows read name, with each window; a row of another player's is in no one's view (my_crowd_paid).
          -- Row bound: the wallet rows read are at most 200 settlements, and a settlement pays one player at most its `most` Acts (the cap recorded when it was paid), so at most 200 times `most` rows.
          -- `most` is that recorded cap, so the log says "the most one settlement pays" of the cap in force then, not today's setting.
          SELECT c.settlement,
             c.act,
             c.most,
             s.starts_at,
             s.ends_at
            FROM my_crowd_paid c
              JOIN settlements s ON s.id = c.settlement
           WHERE (c.settlement IN ( SELECT x.settlement
                    FROM wl x
                   WHERE ((x.kind = 'crowd'::text) AND (x.settlement IS NOT NULL))))
         ), sa AS MATERIALIZED (
          SELECT s.settlement,
             s."character",
             s.named_class,
             s.play,
             s.card,
             s.starts_at,
             s.ends_at
            FROM my_scored_as s
           WHERE (s.ends_at <= COALESCE(log_page.in_before, 'infinity'::timestamp with time zone))
           ORDER BY s.ends_at DESC, s.settlement, s."character"
          LIMIT 200
         ), bl AS MATERIALIZED (
          SELECT b.act,
             b.poll,
             b."character",
             b.picks,
             b.created_at AS at,
             (p.payload ->> 'question'::text) AS question,
             ((p.payload ->> 'secret'::text))::boolean AS secret,
             (p.payload -> 'options'::text) AS options,
             COALESCE(( SELECT (jsonb_array_length(o.picks) > 0)
                    FROM my_ballots o
                   WHERE o.poll = b.poll AND o."character" = b."character" AND (o.created_at, o.act) < (b.created_at, b.act)
                   ORDER BY o.created_at DESC, o.act DESC
                  LIMIT 1), false) AS changed,
             jsonb_build_object('kind', 'post', 'thread', pp.thread, 'title', t.title, 'seq', pp.seq) AS place
            FROM (((my_ballots b
              JOIN acts_public p ON ((p.id = b.poll)))
              JOIN acts_public pp ON ((pp.id = p.target_act_id)))
              JOIN threads t ON ((t.id = pp.thread)))
           WHERE (b.created_at <= COALESCE(log_page.in_before, 'infinity'::timestamp with time zone))
           ORDER BY b.created_at DESC, b.act
          LIMIT 200
         ), pcl AS MATERIALIZED (
          SELECT k.act,
             k.poll,
             k."character",
             k.created_at AS at,
             (p.payload ->> 'question'::text) AS question,
             jsonb_build_object('kind', 'post', 'thread', pp.thread, 'title', t.title, 'seq', pp.seq) AS place
            FROM ((((my_poll_closes k
              JOIN acts_public p ON ((p.id = k.poll)))
              JOIN acts_public pp ON ((pp.id = p.target_act_id)))
              JOIN threads t ON ((t.id = pp.thread))))
           WHERE (k.created_at <= COALESCE(log_page.in_before, 'infinity'::timestamp with time zone))
           ORDER BY k.created_at DESC, k.act
          LIMIT 200
         ), tn AS MATERIALIZED (
          SELECT t.act,
             t."character",
             t.at,
             t.was
            FROM turns_announced t
           WHERE (t."character" IN ( SELECT m.id
                    FROM mine m))
         ), named(id) AS (
          SELECT x.act
            FROM sh x
           WHERE (x.act IS NOT NULL)
         UNION
          SELECT t.act
            FROM tn t
           WHERE (EXISTS ( SELECT 1
                    FROM mine m
                   WHERE ((m.id = t."character") AND (date_trunc('milliseconds'::text, m.class_since) = date_trunc('milliseconds'::text, t.at)))))
         UNION
          SELECT x.act
            FROM cd x
           WHERE (x.act IS NOT NULL)
         UNION
          SELECT x.play
            FROM po x
         UNION
          SELECT x.post
            FROM po x
           WHERE (x.post IS NOT NULL)
         UNION
          SELECT x.play
            FROM wr x
         UNION
          SELECT x.post
            FROM wr x
         UNION
          SELECT x.play
            FROM dr x
         UNION
          SELECT x.post
            FROM dr x
         UNION
          SELECT x.play
            FROM wd x
         UNION
          SELECT x.post
            FROM wd x
         UNION
          SELECT x.play
            FROM sv x
         UNION
          SELECT x.post
            FROM sv x
           WHERE (x.post IS NOT NULL)
         UNION
          SELECT x.post
            FROM se x
           WHERE (x.post IS NOT NULL)
         UNION
          SELECT x.spring
            FROM se x
           WHERE (x.spring IS NOT NULL)
         UNION
          SELECT x.post
            FROM sp x
           WHERE (x.post IS NOT NULL)
         UNION
          SELECT x.play
            FROM ca x
         UNION
          SELECT x.post
            FROM ca x
           WHERE (x.post IS NOT NULL)
         UNION
          SELECT x.play
            FROM en x
         UNION
          SELECT x.ref
            FROM wl x
           WHERE ((x.kind = ANY (ARRAY['bribe'::text, 'gift_out'::text, 'gift_in'::text])) AND (x.ref IS NOT NULL))
         UNION
          SELECT x.act
            FROM cp x
         ), walk(id, depth) AS (
          SELECT n.id,
             0 AS "?column?"
            FROM named n
         UNION
          SELECT f.id,
             (w.depth + 1)
            FROM ((walk w
              JOIN acts_public a ON ((a.id = w.id)))
              CROSS JOIN LATERAL ( VALUES (
                         CASE
                             WHEN (a.kind = ANY (ARRAY['card'::text, 'spring'::text, 'set'::text, 'donation'::text])) THEN a.target_act_id
                             ELSE NULL::uuid
                         END), (
                         CASE
                             WHEN ((a.kind = 'intercept'::text) AND ((a.payload ->> 'visit_act'::text) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'::text)) THEN ((a.payload ->> 'visit_act'::text))::uuid
                             ELSE NULL::uuid
                         END), (
                         CASE
                             WHEN ((a.kind = ANY (ARRAY['spring'::text, 'card'::text])) AND ((a.payload ->> 'spring'::text) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'::text)) THEN ((a.payload ->> 'spring'::text))::uuid
                             ELSE NULL::uuid
                         END), (
                         CASE
                             WHEN ((a.kind = 'spring'::text) AND ((a.payload ->> 'caught'::text) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'::text)) THEN ((a.payload ->> 'caught'::text))::uuid
                             ELSE NULL::uuid
                         END), (
                         CASE
                             WHEN ((a.kind = 'spring'::text) AND ((a.payload ->> 'by'::text) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'::text)) THEN ((a.payload ->> 'by'::text))::uuid
                             ELSE NULL::uuid
                         END)) f(id))
           WHERE ((w.depth < 2) AND (f.id IS NOT NULL))
         ), ac AS MATERIALIZED (
          SELECT a.id,
             a."character",
             a.kind,
             a.thread,
             a.target_act_id,
             a.seq,
             a.created_at,
             a.payload,
             a.current_payload,
             a.edited_at,
             a.shown_edited_at,
             a.untaken,
             a.ends_at,
             a.hidden,
             a.any_hidden,
             a.concealing,
             a.payload_hidden,
             a.payload_concealing
            FROM acts_public a
           WHERE (a.id IN ( SELECT w.id
                    FROM walk w))
         ), reach AS MATERIALIZED (
          SELECT (a.payload ->> 'reach'::text) AS kind,
                 CASE
                     WHEN ((a.payload ->> (a.payload ->> 'reach'::text)) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'::text) THEN ((a.payload ->> (a.payload ->> 'reach'::text)))::uuid
                     ELSE NULL::uuid
                 END AS target
            FROM ac a
           WHERE ((a.kind = 'card'::text) AND (jsonb_typeof((a.payload -> 'targetName'::text)) IS DISTINCT FROM 'string'::text) AND ((a.payload ->> 'reach'::text) = ANY (ARRAY['character'::text, 'thread'::text, 'board'::text])))
         ), pe(id) AS (
          SELECT a."character"
            FROM ac a
           WHERE ((a."character" IS NOT NULL) AND (NOT (a."character" IN ( SELECT m.id
                    FROM mine m))))
         UNION
          SELECT x."character"
            FROM dr x
           WHERE (NOT (x."character" IN ( SELECT m.id
                    FROM mine m)))
         UNION
          SELECT x."character"
            FROM wd x
           WHERE (NOT (x."character" IN ( SELECT m.id
                    FROM mine m)))
         UNION
          SELECT r.target
            FROM reach r
           WHERE ((r.kind = 'character'::text) AND (r.target IS NOT NULL) AND (NOT (r.target IN ( SELECT m.id
                    FROM mine m))))
         ), th(id) AS (
          SELECT a.thread
            FROM ac a
           WHERE (a.id IN ( SELECT t.act
                    FROM tn t
                   WHERE (EXISTS ( SELECT 1
                            FROM mine m
                           WHERE ((m.id = t."character") AND (date_trunc('milliseconds'::text, m.class_since) = date_trunc('milliseconds'::text, t.at)))))))
         UNION
          SELECT r.target
            FROM reach r
           WHERE ((r.kind = 'thread'::text) AND (r.target IS NOT NULL))
         )
  SELECT jsonb_build_object('sources', jsonb_build_object('ledger', COALESCE(( SELECT jsonb_agg(to_jsonb(x.*) ORDER BY x.ends_at DESC, x.settlement, x."character", x.reason) AS jsonb_agg
            FROM lg x), '[]'::jsonb), 'wallet', COALESCE(( SELECT jsonb_agg(to_jsonb(x.*) ORDER BY x.at DESC, x.settlement, x.kind, x.ref, x.change, x.overflow, x.floored, x.balance_after) AS jsonb_agg
            FROM wl x), '[]'::jsonb), 'cards', COALESCE(( SELECT jsonb_agg(to_jsonb(x.*) ORDER BY x.at DESC, x.card, x.kind, x.act, x.price, x.pack) AS jsonb_agg
            FROM cd x), '[]'::jsonb), 'packs', COALESCE(( SELECT jsonb_agg(to_jsonb(x.*) ORDER BY x.bought_at DESC, x.id) AS jsonb_agg
            FROM pk x), '[]'::jsonb), 'playsOnMine', COALESCE(( SELECT jsonb_agg(to_jsonb(x.*) ORDER BY x.at DESC, x.play) AS jsonb_agg
            FROM po x), '[]'::jsonb), 'writes', COALESCE(( SELECT jsonb_agg(to_jsonb(x.*) ORDER BY x.at DESC, x.play, x.version) AS jsonb_agg
            FROM wr x), '[]'::jsonb), 'draws', COALESCE(( SELECT jsonb_agg(to_jsonb(x.*) ORDER BY x.at DESC, x.act, x.mine) AS jsonb_agg
            FROM dr x), '[]'::jsonb), 'wallsDrawn', COALESCE(( SELECT jsonb_agg(to_jsonb(x.*) ORDER BY x.at DESC, x.act, x.mine) AS jsonb_agg
            FROM wd x), '[]'::jsonb), 'saves', COALESCE(( SELECT jsonb_agg(to_jsonb(x.*) ORDER BY x.saved_at DESC, x.play) AS jsonb_agg
            FROM sv x), '[]'::jsonb), 'setEnds', COALESCE(( SELECT jsonb_agg(to_jsonb(x.*) ORDER BY x.ended_at DESC, x.play) AS jsonb_agg
            FROM se x), '[]'::jsonb), 'setPasses', COALESCE(( SELECT jsonb_agg(to_jsonb(x.*) ORDER BY x.passed_at DESC, x.play) AS jsonb_agg
            FROM sp x), '[]'::jsonb), 'caught', COALESCE(( SELECT jsonb_agg(to_jsonb(x.*) ORDER BY x.at DESC, x.play) AS jsonb_agg
            FROM ca x), '[]'::jsonb), 'ended', COALESCE(( SELECT jsonb_agg(to_jsonb(x.*) ORDER BY x.at DESC, x.card_end) AS jsonb_agg
            FROM en x), '[]'::jsonb), 'infractions', COALESCE(( SELECT jsonb_agg(to_jsonb(x.*) ORDER BY x.at DESC, x.infraction) AS jsonb_agg
            FROM inf x), '[]'::jsonb), 'bans', COALESCE(( SELECT jsonb_agg(to_jsonb(x.*) ORDER BY x.at DESC, x.ban) AS jsonb_agg
            FROM bn x), '[]'::jsonb), 'falls', COALESCE(( SELECT jsonb_agg(to_jsonb(x.*) ORDER BY x.at DESC, x.infraction) AS jsonb_agg
            FROM fl x), '[]'::jsonb), 'groupMoves', COALESCE(( SELECT jsonb_agg(to_jsonb(x.*) ORDER BY x.at DESC, x.move) AS jsonb_agg
            FROM gm x), '[]'::jsonb), 'reports', COALESCE(( SELECT jsonb_agg(to_jsonb(x.*) ORDER BY x.at DESC, x.report) AS jsonb_agg
            FROM rp x), '[]'::jsonb), 'appeals', COALESCE(( SELECT jsonb_agg(to_jsonb(x.*) ORDER BY x.at DESC, x.appeal) AS jsonb_agg
            FROM ap x), '[]'::jsonb), 'cosmetics', COALESCE(( SELECT jsonb_agg(to_jsonb(x.*) ORDER BY x.at DESC, x.kind, x.id) AS jsonb_agg
            FROM cs x), '[]'::jsonb), 'crowd', COALESCE(( SELECT jsonb_agg(to_jsonb(x.*) ORDER BY x.settlement DESC, ((x.act)::text COLLATE "C")) AS jsonb_agg
            FROM cp x), '[]'::jsonb), 'ballots', COALESCE(( SELECT jsonb_agg(to_jsonb(x.*) ORDER BY x.at DESC, x.act) AS jsonb_agg
            FROM bl x), '[]'::jsonb), 'pollCloses', COALESCE(( SELECT jsonb_agg(to_jsonb(x.*) ORDER BY x.at DESC, x.act) AS jsonb_agg
            FROM pcl x), '[]'::jsonb)), 'shares', COALESCE(( SELECT jsonb_agg(to_jsonb(x.*) ORDER BY x.settlement DESC, x."character", x.reason, x.card, x.act, x.quadrant) AS jsonb_agg
            FROM sh x), '[]'::jsonb), 'scoredAs', COALESCE(( SELECT jsonb_agg(to_jsonb(x.*) ORDER BY x.ends_at DESC, x.settlement, x."character") AS jsonb_agg
            FROM sa x), '[]'::jsonb), 'acts', COALESCE(( SELECT jsonb_agg(to_jsonb(a.*) ORDER BY a.created_at, ((a.id)::text COLLATE "C")) AS jsonb_agg
            FROM ac a), '[]'::jsonb), 'states', COALESCE(( SELECT jsonb_agg(to_jsonb(e.*) ORDER BY ((e.play)::text COLLATE "C")) AS jsonb_agg
            FROM ( SELECT s.play,
                     s.state,
                     s.saved_at
                    FROM effect_state s
                   WHERE (s.play IN ( SELECT v.play
                            FROM sv v))) e), '[]'::jsonb), 'people', COALESCE(( SELECT jsonb_agg(f.face ORDER BY f.name, f.id) AS jsonb_agg
            FROM ( SELECT cp.name,
                     cp.id,
                     (to_jsonb(cp.*) || jsonb_build_object('profile', ( SELECT (to_jsonb(p.*) || profile_cosmetics(p."character"))
                            FROM ( SELECT r."character",
                                     r.title,
                                     r.signature,
                                     r.avatar_square,
                                     r.avatar_portrait,
                                     r.square_frame,
                                     r.portrait_frame,
                                     r.pip_style,
                                     r.pronouns
                                    FROM character_profiles r
                                   WHERE (r."character" = cp.id)) p))) AS face
                    FROM ( SELECT c.id,
                             c.name,
                             c.joined,
                             c.staff,
                             c.office,
                             c."group"
                            FROM characters_public c
                           WHERE (c.id IN ( SELECT p.id
                                    FROM pe p))) cp) f), '[]'::jsonb), 'threads', COALESCE(( SELECT jsonb_agg(to_jsonb(t.*) ORDER BY t.created_at, ((t.id)::text COLLATE "C")) AS jsonb_agg
            FROM thread_open t
           WHERE (t.id IN ( SELECT h.id
                    FROM th h))), '[]'::jsonb), 'boards', COALESCE(( SELECT jsonb_agg(to_jsonb(b.*) ORDER BY ((b.id)::text COLLATE "C")) AS jsonb_agg
            FROM ( SELECT n.id,
                     n.slug,
                     n.name,
                     n.description,
                     n.is_system,
                     n.move_act
                    FROM boards_now n
                   WHERE (n.id IN ( SELECT r.target
                            FROM reach r
                           WHERE ((r.kind = 'board'::text) AND (r.target IS NOT NULL))))) b), '[]'::jsonb), 'standings', COALESCE(( SELECT jsonb_agg(to_jsonb(s.*) ORDER BY ((s."character")::text COLLATE "C")) AS jsonb_agg
            FROM ( SELECT c."character",
                     c.standing
                    FROM current_standings c
                   WHERE (c."character" IN ( SELECT m.id
                            FROM mine m))) s), '[]'::jsonb), 'turns', COALESCE(( SELECT jsonb_agg(to_jsonb(t.*) ORDER BY t.at, ((t.act)::text COLLATE "C")) AS jsonb_agg
            FROM tn t), '[]'::jsonb), 'season', ( SELECT to_jsonb(s.*) AS to_jsonb
            FROM current_season s
          LIMIT 1)) AS jsonb_build_object
  );
end
$function$;

-- ===================================================================================== 5. system_digest ====
-- system_digest (0366_excerpts_and_orders.sql), an excerpt also carrying its post's current poll (read through acts_public as the digest's role reads, a removal having no counts row): the question, each option's words and count, and whether it is closed. A count is characters, and no voter is named, public or secret. Everything else as 0366 wrote it (owner and grants kept).
create or replace function system_digest(since timestamptz, until timestamptz) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  threads_cap integer := (setting('digestThreads'))::integer;
  short_cap integer := (setting('digestExcerpts'))::integer;
  chars integer := (setting('digestExcerptChars'))::integer;
  board_cap integer;
  board_days integer;
  hours numeric;
  result jsonb;
  uuid_re constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  met_by_most constant integer := 8;
begin
  if since is null or until is null or until <= since then
    raise exception 'a digest covers a window that ends after it starts' using errcode = '22023';
  end if;
  -- The board lines' two settings: an instance that has not set them (seeded before them) reads the defaults, as inheritance_due reads inheritanceGraceDays.
  begin board_cap := (setting('digestBoards'))::integer; exception when no_data_found then board_cap := 30; end;
  begin board_days := (setting('digestBoardDays'))::integer; exception when no_data_found then board_days := 21; end;
  hours := greatest(extract(epoch from (until - since)) / 3600.0, 1.0 / 60);
  with
  w as (
    select p.id, p.thread, p.character, p.target_act_id, p.created_at, left(p.current_payload ->> 'body', chars) as excerpt,
           coalesce(length(p.current_payload ->> 'body') > chars, false) as cut
    from acts_public p
    where p.kind = 'post' and p.created_at >= since and p.created_at < until and p.character is not null
  ),
  react as (
    select w.thread, reaction_quadrant(t.act, t.kind) as quadrant, sum(t.count)::integer as n
    from w join reaction_tallies_open t on t.act = w.id
    group by w.thread, reaction_quadrant(t.act, t.kind)
  ),
  split as (
    select r.thread, sum(r.n) as total, max(r.n) as biggest from react r group by r.thread
  ),
  hot as (
    select tl.id as thread, left(tl.title, 120) as title, tl.board as board_id, h.posts,
           round(h.posts / hours, 2) as heat,
           round(coalesce(1 - s.biggest::numeric / nullif(s.total, 0), 0), 4) as controversy,
           tl.last_seq as length
    from (select w.thread, count(*) as posts from w group by w.thread) h
    join thread_list tl on tl.id = h.thread
    left join split s on s.thread = h.thread
    order by h.posts desc, coalesce(1 - s.biggest::numeric / nullif(s.total, 0), 0) desc, tl.id
    limit threads_cap
  ),
  -- Order and cut first, number after. The order is the standings screen's, amount then name (then the character, for
  -- a tie of both), so the top rows come off standings_season_amount (season, amount desc, name; 0030) already in order
  -- and stop at the cap: the season's rows are never sorted, only the few of a tie are. The rank is numbered over the cut.
  -- A row that is not a public character is skipped inside the cut, so the cap is still full.
  stand as (
    select row_number() over (order by top.amount desc, top.name, top.character) as rank, top.character, top.amount
    from (
      select s.character, s.amount, s.name
      from standings s
      where s.season = standings_season()
        and exists (select 1 from settlements x where x.ends_at > since and x.ends_at <= until)
        and exists (select 1 from characters_public cp where cp.id = s.character)
      order by s.amount desc, s.name, s.character
      limit short_cap
    ) top
  ),
  quoted as (
    select w.character as q_from, tgt.character as q_to, count(*) as n
    from w join acts_public tgt on tgt.id = w.target_act_id
    where tgt.kind = 'post' and tgt.character is not null and tgt.character <> w.character
    group by w.character, tgt.character
    order by count(*) desc, w.character, tgt.character
    limit short_cap
  ),
  boss as (
    select cp.id from characters_public cp where cp.staff is not null and cp.staff = current_boss()
  ),
  boss_acts as (
    select a.id, a.thread
    from acts_public a
    where a.character in (select id from boss) and a.kind in ('post', 'spin', 'card')
      and a.created_at >= since - (until - since) and a.created_at < until
  ),
  boss_tally as (
    select ba.id as act, ba.thread, sum(t.count)::integer as total, jsonb_object_agg(t.kind, t.count order by t.kind) as tally
    from boss_acts ba join reaction_tallies_open t on t.act = ba.id
    group by ba.id, ba.thread
    order by sum(t.count) desc, ba.id
    limit short_cap
  ),
  excerpted as (
    select w.id as act, w.thread, w.character, coalesce(sum(t.count), 0)::integer as reactions, w.excerpt, w.cut, w.created_at
    from w left join reaction_tallies_open t on t.act = w.id
    group by w.id, w.thread, w.character, w.excerpt, w.cut, w.created_at
    order by coalesce(sum(t.count), 0) desc, w.created_at desc, w.id
    limit short_cap
  ),
  -- The moves in force (open_moves: a handful of rows, whatever the instance's history) and those whose end fell in the window,
  -- each capped (the reversals first, so a met move's end cannot crowd one out); the merge below orders and caps them again. An end after the window is not the digest's yet.
  open_m as (
    select a.id as act, a.created_at as landed_at, a.payload, null::jsonb as ended, 1 as grp, 'inForce'::text as state, a.created_at as sort_at, null::timestamptz as held_at, null::text as why
    from open_moves o join acts_public a on a.id = o.move_act
    where a.created_at < until
    order by a.created_at desc, a.id
    limit short_cap
  ),
  ended_m as (
    select a.id as act, a.created_at as landed_at, a.payload,
           jsonb_build_object('why', e.payload ->> 'why', 'by', e.payload ->> 'by', 'at', e.created_at) as ended,
           case when e.payload ->> 'by' = 'admin' then 0 else 2 end as grp, 'ended'::text as state, e.created_at as sort_at, null::timestamptz as held_at, null::text as why
    from acts_public e join acts_public a on a.id = e.target_act_id
    where e.kind = 'move_end' and e.created_at >= since and e.created_at < until
    order by (e.payload ->> 'by' = 'admin') desc, e.created_at desc, e.id
    limit short_cap
  ),
  -- A move an admin held in the window never landed, so it has no Act: its row in the queue (the columns the digest role may read).
  held_m as (
    select null::uuid as act, null::timestamptz as landed_at,
           jsonb_build_object('kind', q.kind, 'params', q.params, 'demand', q.demand, 'expires_at', q.expires_at) as payload,
           null::jsonb as ended, 0 as grp, 'held'::text as state, q.held_at as sort_at, q.held_at, q.why
    from queued_moves q
    where q.held_at >= since and q.held_at < until
    order by q.held_at desc, q.id
    limit short_cap
  ),
  moved as (
    select * from (select * from open_m union all select * from ended_m union all select * from held_m) u order by u.grp, u.sort_at desc, u.act limit short_cap
  ),
  -- The moves in the list that ended `met`, with the params of their demand read as the demand evaluator reads them. A param that is
  -- not what its kind needs reads null, so one malformed move cannot stop the digest.
  met_m as (
    select m.act, m.landed_at, (m.ended ->> 'at')::timestamptz as end_at, m.payload #>> '{demand,kind}' as dkind,
           case when m.payload #>> '{demand,params,board}' ~ uuid_re then (m.payload #>> '{demand,params,board}')::uuid end as board,
           case when m.payload #>> '{demand,params,thread}' ~ uuid_re then (m.payload #>> '{demand,params,thread}')::uuid end as thread,
           case when m.payload #>> '{demand,params,character}' ~ uuid_re then (m.payload #>> '{demand,params,character}')::uuid end as character,
           case when m.payload #>> '{demand,params,a}' ~ uuid_re then (m.payload #>> '{demand,params,a}')::uuid end as a,
           case when m.payload #>> '{demand,params,b}' ~ uuid_re then (m.payload #>> '{demand,params,b}')::uuid end as b,
           m.payload #>> '{demand,params,quadrant}' as quadrant,
           case when m.payload #>> '{demand,params,count}' ~ '^[0-9]{1,9}$' then (m.payload #>> '{demand,params,count}')::integer end as cnt
    from moved m
    where m.state = 'ended' and m.ended ->> 'why' = 'met' and jsonb_typeof(m.payload -> 'demand') = 'object'
  ),
  -- Who met a move: the public, non-staff characters whose public Acts counted toward its demand, from the landing to the end. For the
  -- two board counts, whoever posted on the board in between, in the order they first did; for a quadrant, the authors of the posts whose
  -- public tallies counted, the most reacted first; for a post in a thread, the character named; for a crossQuote, the two. A staff
  -- character's Acts never count (the evaluator skips them) and are never listed. Only public relations, and never a reactor.
  met_credit as (
    select p.act, p.character, min(p.created_at) as first_at, 0::bigint as weight
    from (
      -- postsOnBoard: the posts demand_progress counted, the first `count` after the landing (oldest first, staff skipped), read as it
      -- reads them: the Acts in time order from the landing, limited to `count` matches (the header says what that does and doesn't
      -- bound). A post after the count was reached, before the tick noticed, is not the move's.
      select mm.act, x.character, x.created_at
      from met_m mm
      cross join lateral (
        select a.character, a.created_at
        from acts_public a
        join characters_public c on c.id = a.character
        where a.thread in (select tl.id from thread_list tl where tl.board = mm.board)
          and a.kind = 'post' and a.created_at > mm.landed_at and a.created_at <= mm.end_at and c.staff is null
        order by a.created_at, a.id
        limit mm.cnt
      ) x
      where mm.dkind = 'postsOnBoard' and mm.cnt >= 1
    ) p
    group by p.act, p.character
    union all
    -- distinctCharactersOnBoard: the first `count` distinct characters to post after the landing, in the order they first did. Each step
    -- finds the next post, in time order from the previous step's, by a character not yet found; every post skipped on the way is by one
    -- already found (or a staff character), so the steps are the characters' first posts in order, and the walk reads the Acts up to the
    -- `count`th new character's first post and no further.
    select w.act, w.character, w.created_at, 0::bigint
    from (
      with recursive walk(act, board, end_at, cnt, n, character, created_at, id, found) as (
        select mm.act, mm.board, mm.end_at, mm.cnt, 0, null::uuid, mm.landed_at, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid, '{}'::uuid[]
        from met_m mm
        where mm.dkind = 'distinctCharactersOnBoard' and mm.cnt >= 1
        union all
        select w.act, w.board, w.end_at, w.cnt, w.n + 1, x.character, x.created_at, x.id, w.found || x.character
        from walk w
        cross join lateral (
          select a.character, a.created_at, a.id
          from acts_public a
          join characters_public c on c.id = a.character
          where a.thread in (select tl.id from thread_list tl where tl.board = w.board)
            and a.kind = 'post' and a.created_at >= w.created_at and a.created_at <= w.end_at and (a.created_at, a.id) > (w.created_at, w.id)
            and a.character <> all (w.found) and c.staff is null
          order by a.created_at, a.id
          limit 1
        ) x
        where w.n < w.cnt
      )
      select * from walk where n >= 1
    ) w
    union all
    -- quadrantOnBoard: the public tally as it stands when the digest is built, not as of the move's end. A reaction after the end can raise
    -- it, and a public tally keeps no time per reaction (a reaction's time is private, and is never read here), so this credit may include
    -- an author a later reaction put in the quadrant.
    select mm.act, a.character, min(a.created_at), -sum(t.count)::bigint
    from met_m mm
    join thread_list tl on tl.board = mm.board
    join acts_public a on a.thread = tl.id
    join characters_public c on c.id = a.character
    join reaction_tallies_open t on t.act = a.id
    where mm.dkind = 'quadrantOnBoard' and reaction_quadrant(t.act, t.kind) = mm.quadrant
      and a.kind = 'post' and a.created_at > mm.landed_at and a.created_at <= mm.end_at and c.staff is null
    group by mm.act, a.character
    having sum(t.count) > 0
    union all
    select mm.act, a.character, min(a.created_at), 0::bigint
    from met_m mm
    join acts_public a on a.thread = mm.thread and a.character = mm.character
    join characters_public c on c.id = a.character
    where mm.dkind = 'characterPostsInThread'
      and a.kind = 'post' and a.created_at > mm.landed_at and a.created_at <= mm.end_at and c.staff is null
    group by mm.act, a.character
    union all
    select mm.act, c.id, mm.landed_at, (case when c.id = mm.a then 0 else 1 end)::bigint
    from met_m mm
    join characters_public c on c.id in (mm.a, mm.b)
    where mm.dkind = 'crossQuote' and c.staff is null
  ),
  met_top as (
    select r.act, r.character, r.rank
    from (select x.act, x.character, row_number() over (partition by x.act order by x.weight, x.first_at, x.character) as rank from met_credit x) r
    where r.rank <= met_by_most
  ),
  -- The board lines: each open board that is not The System's, with the posts on it over the `board_days` days before the window's end, on the board each thread is on now
  -- (threads.board, which a move that landed has already changed). Public posts of public characters only, counted per board and read from nothing else: no owner,
  -- account, class or reaction. The count is one range of the partial index acts_posts_by_time and one primary-key read per thread's post, grouped by board; the lines are the
  -- number of boards, which a busy instance keeps small. When there are more than `board_cap`, the busiest half (the odd one too) and the quietest half; the numbering is over
  -- the ordered whole, so the two halves cannot overlap, and a cap the boards do not reach keeps them all.
  board_posts as (
    select tl.board, count(*)::integer as n
    from acts_public p join threads tl on tl.id = p.thread
    where p.kind = 'post' and p.character is not null and p.created_at >= until - make_interval(days => board_days) and p.created_at < until
    group by tl.board
  ),
  board_all as (
    select bn.id, left(bn.name, 120) as name, left(bn.premise, 200) as premise, coalesce(bp.n, 0) as n,
           row_number() over (order by coalesce(bp.n, 0) desc, bn.id) as rn, count(*) over () as total
    from boards_now bn left join board_posts bp on bp.board = bn.id
    where not bn.is_system and not bn.closed
  ),
  board_lines as (
    select x.id, x.name, x.premise, x.n, x.rn from board_all x
    where x.rn <= (board_cap + 1) / 2 or x.rn > x.total - board_cap / 2
  ),
  named as (
    select q_from as id from quoted union select q_to from quoted union select character from stand union select character from excerpted
    union select character from met_top
  )
  select jsonb_build_object(
    'since', since,
    'until', until,
    'threads', coalesce((select jsonb_agg(jsonb_build_object('thread', h.thread, 'title', h.title, 'board', (select bn.name from boards_now bn where bn.id = h.board_id), 'posts', h.posts,
                          'heat', h.heat, 'controversy', h.controversy, 'length', h.length)
                         order by h.posts desc, h.controversy desc, h.thread) from hot h), '[]'::jsonb),
    'boards', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'name', l.name, 'premise', l.premise, 'posts', l.n) order by l.rn) from board_lines l), '[]'::jsonb),
    'boardDays', board_days,
    'standings', coalesce((select jsonb_agg(jsonb_build_object('rank', s.rank, 'character', s.character, 'amount', s.amount) order by s.rank) from stand s), '[]'::jsonb),
    'moves', coalesce((select jsonb_agg(jsonb_build_object('act', m.act, 'kind', m.payload ->> 'kind', 'params', m.payload -> 'params',
                          'demand', m.payload -> 'demand', 'expiresAt', m.payload -> 'expires_at', 'landedAt', m.landed_at,
                          'progress', case when m.state = 'held' then null else demand_progress_or_error(m.act) end, 'ended', m.ended, 'state', m.state)
                          || case when m.state = 'held' then jsonb_build_object('heldAt', m.held_at, 'why', m.why) else '{}'::jsonb end
                          || case when m.state = 'ended' and m.ended ->> 'why' = 'met'
                                  then jsonb_build_object('metBy', coalesce((select jsonb_agg(t.character order by t.rank) from met_top t where t.act = m.act), '[]'::jsonb))
                                  else '{}'::jsonb end
                          order by m.grp, m.sort_at desc, m.act) from moved m), '[]'::jsonb),
    'quotes', coalesce((select jsonb_agg(jsonb_build_object('from', q.q_from, 'to', q.q_to, 'count', q.n) order by q.n desc, q.q_from, q.q_to) from quoted q), '[]'::jsonb),
    'bossReactions', coalesce((select jsonb_agg(jsonb_build_object('act', bt.act, 'thread', bt.thread, 'total', bt.total, 'tally', bt.tally) order by bt.total desc, bt.act) from boss_tally bt), '[]'::jsonb),
    'excerpts', coalesce((select jsonb_agg(jsonb_build_object('act', e.act, 'thread', e.thread, 'character', e.character, 'reactions', e.reactions, 'text', e.excerpt, 'cut', e.cut)
                          || coalesce((select jsonb_build_object('poll', jsonb_build_object('question', p.payload ->> 'question',
                                         'options', (select coalesce(jsonb_agg(jsonb_build_object('text', o.t, 'count', coalesce(c.counts[o.n::integer], 0)) order by o.n), '[]'::jsonb)
                                                     from jsonb_array_elements_text(p.payload -> 'options') with ordinality o(t, n)),
                                         'closed', c.closed))
                                       from (select a.id, a.payload from acts_public a where a.kind = 'poll' and a.target_act_id = e.act order by a.created_at desc, a.id desc limit 1) p
                                       join poll_counts c on c.poll = p.id), '{}'::jsonb)
                          order by e.reactions desc, e.created_at desc, e.act) from excerpted e), '[]'::jsonb),
    'characters', coalesce((select jsonb_agg(jsonb_build_object('id', cp.id, 'name', cp.name, 'staff', cp.staff is not null and cp.office is distinct from 'anonymous',
                                                                'pronouns', (select p.pronouns from character_profiles p where p.character = cp.id)) order by cp.id)
                            from characters_public cp where cp.id in (select id from named)), '[]'::jsonb)
  ) into result;
  return result;
end $$;
