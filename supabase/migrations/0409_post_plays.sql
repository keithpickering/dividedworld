-- The plays on a post, read through the kept rows (docs/plans/2026-11-21-post-plays-plan.md, Task 3; design docs/plans/2026-11-21-post-plays-design.md, sections 1, 2, 5 and 6).
-- A page reads, for each post it shows, the plays that hold a place (in force), two stand-ins for each kind the post has had (its newest play and its most drawn, each whether over or not), and a count for each kind. The plays are found in
-- play_post and post_kinds (0407, 0408), which no API role reads, by a few definer functions that answer ids and counts alone; the Acts themselves are read through acts_public as the caller, so concealment holds as it did in thread_page.
-- The cap goes: thread_page's "oldest 8" a post and the origin box's "oldest 20" and its `more` flag. The read is bounded by the instance's stacks and its number of cards, at any age of the post.
--
--   1. the indexes           play_post_newest and play_post_drawn, on the rows a stand-in can be (a card, or a back that sprang): the two ways a kind's history is read.
--   2. post_play_ids         definer: for each post, the plays in force, the sprung backs whose lockout is live and, for each of its kinds, the first row of each index. Ids only.
--   3. post_kind_counts      definer: the post_kinds rows of a list of posts, a back's kind as a null card.
--   4. play_rider_ids        definer: the ids of the springs and take-backs of a list of backs (acts_public cannot use the expression indexes that find them: its payload is shown_payload(...) of acts.payload).
--   5. kind_play_ids         definer: a page of a kind's plays that are not in force, newest first from a cursor.
--   6. post_plays            invoker: the plays of up to 200 posts as acts_public shows them with their riders, and the counts.
--   7. kind_plays            invoker: a page of a kind's older plays, with their riders, tallies, the caller's own reactions, the threads spun from them and their casters' heads.
--   8. thread_page           copied whole from 0402_thread_lockout.sql (the plan named 0396; 0402 is the latest): `on_posts` is the plays of post_play_ids and their springs and take-backs (`on_all` holds the ids); the origin's `o_plays` the same
--                            for the origin post; the page gains `counts` and the origin gains `counts` and loses `more`. Nothing else changes.
--
-- The Acts are looked up by `id = any (array(...))`, never `id in (select ...)`: with an array the plan is a probe of the primary key for each id however large acts is, where a semi join with a function's or a CTE's rows is a choice
-- of the planner's that can fall to hashing acts. They name the kinds a play and its riders can be (card, set, spring, take_back; a back's take-back is its rider, as its spring is, though a back taken back is over and never in force, nor a stand-in, so none rides today and the kind only keeps the read whole if one is ever kept) as 0402's read did, which leaves acts_public's arm for secret ballots out of the plan. The origin's reads are gated on there being an origin (`exists (select 1 from o_ids)`), a one-time filter, so a page with none runs none of them.
-- Ways out: nothing here is a state a player is in; a page's plays follow the kept rows, which follow the Acts. An older play is paged from the Lens's Who by kind_plays.
-- Masks: every id and count comes from the kept rows, whose columns are public facts of public Acts; a back's kind is the null card and never names the card; the draw is public sums and spun threads, never who reacted. The four
-- definers behind the reads take no account and compute nothing from who is asking; kind_plays's tallies and `mine` are read as the caller, so only the caller's own reactions are theirs alone, as in thread_page.
-- Cost at a busy instance's scale: a page reads, for each post, one probe of play_post_up for the plays in force, one of play_post_lock for the sprung backs whose lockout is live (a handful of rows, none on most posts) and, for each kind the post has had, one row of each stand-in index; a page of a kind's history reads the page and the
-- plays in force it skips, by one index in order. Both are held to a row bound on a post of 5,000 plays by supabase/tests/0409-post-plays-scale.sql, which goes red with an index withheld.

-- ---- 1. the indexes ----

-- A kind's plays newest first, and most drawn first (a tie to the newer): the two stand-ins, and the pages of a kind's history. A back that did not spring is no stand-in and no page's, so it is not in them.
create index play_post_newest on play_post (post, kind, played_at desc, play desc) where kind <> '' or sprung;
create index play_post_drawn on play_post (post, kind, drawn desc, played_at desc, play desc) where kind <> '' or sprung;

-- ---- 2. post_play_ids ----

-- For each of `posts`, distinct: the plays in force (not over by an event, and with no end or an end ahead: play_post_up, in two probes, no end and an end ahead), the sprung backs whose lockout is still ahead (`lock_until > now()`, play_post_lock:
-- the owner's answer to #993, option a, keeps a back up while the lockout its spring started is live; it is over for the stack, the limit and the counts), and, for each of the post's post_kinds rows, the first row of
-- play_post_newest and of play_post_drawn. A kind '' is the backs that sprang. Set-based over the posts, never a loop. The estimate of rows steers the plans of its callers to probe by id.
create function post_play_ids(posts uuid[]) returns table (post uuid, play uuid)
language sql stable security definer set search_path = public, pg_temp rows 16 as $$
  select p.post, p.play from play_post p where p.post = any (post_play_ids.posts) and p.over_at is null and p.ends_at is null
  union
  select p.post, p.play from play_post p where p.post = any (post_play_ids.posts) and p.over_at is null and p.ends_at > now()
  union
  select p.post, p.play from play_post p where p.post = any (post_play_ids.posts) and p.lock_until > now()
  union
  select k.post, n.play from post_kinds k
    cross join lateral (select p.play from play_post p where p.post = k.post and p.kind = k.kind and (p.kind <> '' or p.sprung) order by p.played_at desc, p.play desc limit 1) n
  where k.post = any (post_play_ids.posts)
  union
  select k.post, d.play from post_kinds k
    cross join lateral (select p.play from play_post p where p.post = k.post and p.kind = k.kind and (p.kind <> '' or p.sprung) order by p.drawn desc, p.played_at desc, p.play desc limit 1) d
  where k.post = any (post_play_ids.posts)
$$;
revoke execute on function post_play_ids(uuid[]) from public, anon;
grant execute on function post_play_ids(uuid[]) to authenticated, service_role;

-- ---- 3. post_kind_counts ----

-- The count of each kind a post has had: how many plays, and how many took. A back's kind is the null card. The same for every caller.
create function post_kind_counts(posts uuid[]) returns table (post uuid, card text, plays integer, took integer)
language sql stable security definer set search_path = public, pg_temp rows 8 as $$
  select k.post, nullif(k.kind, ''), k.plays, k.took from post_kinds k where k.post = any (post_kind_counts.posts)
$$;
revoke execute on function post_kind_counts(uuid[]) from public, anon;
grant execute on function post_kind_counts(uuid[]) to authenticated, service_role;

-- ---- 4. play_rider_ids ----

-- The ids of the springs and take-backs of a list of backs (an Act names its back in `payload.set`; acts_one_spring and acts_one_take_back find them). The page reads the Acts themselves through acts_public by id.
create function play_rider_ids(plays uuid[]) returns setof uuid
language sql stable security definer set search_path = public, pg_temp rows 4 as $$
  select a.id from acts a where a.kind = 'spring' and (a.payload ->> 'set') = any (play_rider_ids.plays::text[])
  union all
  select a.id from acts a where a.kind = 'take_back' and (a.payload ->> 'set') = any (play_rider_ids.plays::text[])
$$;
revoke execute on function play_rider_ids(uuid[]) from public, anon;
grant execute on function play_rider_ids(uuid[]) to authenticated, service_role;

-- ---- 5. kind_play_ids ----

-- A page of a post's plays of a kind (`card` null for backs) that are not in force, newest first by play_post_newest, strictly before the cursor (`before_at`, `before_id`; both null for the first page): at most `lim`.
-- A play in force is skipped as the index is read in order, so a page reads its rows and the kind's plays in force, never the kind's history.
create function kind_play_ids(post uuid, card text, before_at timestamptz, before_id uuid, lim integer) returns table (play uuid, at timestamptz)
language sql stable security definer set search_path = public, pg_temp rows 20 as $$
  select p.play, p.played_at from play_post p
  where p.post = kind_play_ids.post and p.kind = coalesce(kind_play_ids.card, '') and (p.kind <> '' or p.sprung)
    and not (p.over_at is null and (p.ends_at is null or p.ends_at > now()))
    and (p.played_at, p.play) < (coalesce(kind_play_ids.before_at, 'infinity'::timestamptz), coalesce(kind_play_ids.before_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid))
  order by p.played_at desc, p.play desc
  limit kind_play_ids.lim
$$;
revoke execute on function kind_play_ids(uuid, text, timestamptz, uuid, integer) from public, anon;
grant execute on function kind_play_ids(uuid, text, timestamptz, uuid, integer) to authenticated, service_role;

-- ---- 6. post_plays ----

-- The plays of up to 200 posts as the page shows them: `plays`, the Acts of post_play_ids through acts_public with their riders (each play's card_end, each back's spring and take-back, and the card_end of a spring), ordered by
-- created_at, id, each once; and `counts`, { post, card (null for backs), all, took } from post_kinds. An invoker: acts_public answers as the caller. More than 200 posts is refused plainly.
create function post_plays(posts uuid[]) returns jsonb
language plpgsql stable set search_path = public, pg_temp set plan_cache_mode = force_generic_plan set jit = off as $f$
begin
  if cardinality(post_plays.posts) > 200 then raise exception 'ask for at most 200 posts at a time' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  return (
    with ids as materialized (
      select x.post, x.play from post_play_ids(post_plays.posts) x
    ), plays as materialized (
      select a.* from acts_public a where a.kind in ('card', 'set') and a.id = any (array(select i.play from ids i))
    ), riders as materialized (
      select a.* from acts_public a where a.kind in ('spring', 'take_back') and a.id = any (array(select r from play_rider_ids(array(select i.play from ids i)) r))
    ), ends as materialized (
      select a.* from acts_public a where a.kind = 'card_end' and a.target_act_id in (select p.id from plays p union all select r.id from riders r)
    )
    select jsonb_build_object(
      'plays', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at, x.id) from (select * from plays union all select * from riders union all select * from ends) x), '[]'::jsonb),
      'counts', coalesce((select jsonb_agg(jsonb_build_object('post', k.post, 'card', k.card, 'all', k.plays, 'took', k.took) order by k.post, k.card nulls first) from post_kind_counts(post_plays.posts) k), '[]'::jsonb))
  );
end $f$;
revoke execute on function post_plays(uuid[]) from public, anon;
grant execute on function post_plays(uuid[]) to authenticated, service_role;

-- ---- 7. kind_plays ----

-- A page of a post's older plays of a kind (`card` null for backs): those not in force, strictly before (`before_at`, `before_id`), newest first, `size` clamped to 1..50 (null is 20). With their riders, `tallies` and `mine` as
-- thread_page gives them, `spun` (the threads spun from the plays, thread_list's rows as thread_page's `spun`), `cast` (the heads of the plays' casters, as the origin's `cast`, with the lockout of the post's thread), and
-- `next`: { at, id } of the last play when more are left, else null.
-- Definer and invoker: the ids of the page come from kind_play_ids (a definer, because play_post is no API role's) and everything else is read here, as the caller: acts_public, reaction_tallies, my_reactions, thread_list
-- and characters_public. So a caller's own reactions are theirs alone, the plays are shown as the page shows them, and no private fact is computed: the page is the same for every caller, cost and content, but for `mine`.
create function kind_plays(post uuid, card text, before_at timestamptz, before_id uuid, size integer) returns jsonb
language plpgsql stable set search_path = public, pg_temp set plan_cache_mode = force_generic_plan set jit = off as $f$
declare
  lim integer := greatest(1, least(coalesce(kind_plays.size, 20), 50));
begin
  return (
    with page as materialized (
      select x.play, x.at from kind_play_ids(kind_plays.post, kind_plays.card, kind_plays.before_at, kind_plays.before_id, lim + 1) x order by x.at desc, x.play desc
    ), shown as materialized (
      select x.play, x.at from page x order by x.at desc, x.play desc limit lim
    ), plays as materialized (
      select a.* from acts_public a where a.kind in ('card', 'set') and a.id = any (array(select s.play from shown s))
    ), riders as materialized (
      select a.* from acts_public a where a.kind in ('spring', 'take_back') and a.id = any (array(select r from play_rider_ids(array(select s.play from shown s)) r))
    ), ends as materialized (
      select a.* from acts_public a where a.kind = 'card_end' and a.target_act_id in (select p.id from plays p union all select r.id from riders r)
    ), ids as materialized (
      select p.id from plays p union select r.id from riders r union select e.id from ends e
    ), casters as materialized (
      select distinct x.c from (select p."character" as c from plays p union select r."character" from riders r) x where x.c is not null
    ), heads as materialized (
      select c.id,
             jsonb_build_object('character', jsonb_build_object('id', c.id, 'name', c.name, 'joined', c.joined, 'staff', c.staff, 'office', c.office, 'warn_points', c.warn_points, 'banned_until', c.banned_until,
                                                                'locked_until', locked_out_until(c.id, (select t.thread from acts_public t where t.id = kind_plays.post)), 'group', c."group"),
                                'profile', (select (jsonb_build_object('character', p."character", 'title', p.title, 'signature', p.signature, 'avatar_square', p.avatar_square, 'avatar_portrait', p.avatar_portrait,
                                                                       'square_frame', p.square_frame, 'portrait_frame', p.portrait_frame, 'pip_style', p.pip_style, 'pronouns', p.pronouns) || profile_cosmetics(p."character"))
                                            from character_profiles p where p."character" = c.id)) as head
      from casters k cross join lateral (select x.* from characters_public x where x.id = k.c offset 0) c
    ), spun as materialized (
      select l.* from thread_list l where l.origin_act_id in (select s.play from shown s)
    )
    select jsonb_build_object(
      'plays', coalesce((select jsonb_agg(x.j order by x.grp, x.ord, x.created_at, x.id)
                         from (select to_jsonb(p.*) as j, 0 as grp, row_number() over (order by s.at desc, s.play desc) as ord, p.created_at, p.id from plays p join shown s on s.play = p.id
                               union all select to_jsonb(r.*), 1, 0, r.created_at, r.id from riders r
                               union all select to_jsonb(e.*), 2, 0, e.created_at, e.id from ends e) x), '[]'::jsonb),
      'tallies', coalesce((select jsonb_agg(jsonb_build_object('act', t.act, 'kind', t.kind, 'count', t.count)) from reaction_tallies t where t.act in (select i.id from ids i)), '[]'::jsonb),
      'mine', coalesce((select jsonb_agg(jsonb_build_object('act', m.act, 'kind', m.kind, 'character', m."character")) from my_reactions m where m.act in (select i.id from ids i)), '[]'::jsonb),
      'spun', coalesce((select jsonb_agg(to_jsonb(l.*) order by l.created_at, l.id) from spun l), '[]'::jsonb),
      'cast', coalesce((select jsonb_agg(h.head order by h.id) from heads h), '[]'::jsonb),
      'next', case when (select count(*) from page) > lim then (select jsonb_build_object('at', s.at, 'id', s.play) from shown s order by s.at, s.play limit 1) end)
  );
end $f$;
revoke execute on function kind_plays(uuid, text, timestamptz, uuid, integer) from public, anon;
grant execute on function kind_plays(uuid, text, timestamptz, uuid, integer) to authenticated, service_role;

-- ---- 8. thread_page ----

-- thread_page (0402_thread_lockout), the plays of a post through post_play_ids. `on_posts` is the plays in force and the stand-ins of each of the page's posts, with their springs and take-backs (play_rider_ids; `on_all` is the ids of both),
-- read from acts_public as the caller in one read, as 0402's was: the first eight of a post by age are gone, and everything that reads `on_posts` (`played`, `spent`, `surfaces`, and through `played` `ids`, `who`, `wanted_plays`,
-- `faces`) reads the new set unchanged, as `ends_on_posts` (the admin's card_end of a play or a spring on it) does. The origin's `o_plays` is the same for the origin post (`o_ids`, `o_all`), `o_shown` is it as it was, and its `more`
-- flag and the cap of 20 are gone. The page gains `counts` ({ post, card, all, took } for each of its posts), and the origin gains `counts` for its post. Nothing else changes; its grants are as they were.
-- It reads acts_public in no more places than 0402's did: each copy of the view is planned into the function, and a screen function's cold read is held to a budget (supabase/tests/e2e/0028-cold-read-budget.ts).
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
         ), on_ids AS MATERIALIZED (
          SELECT x.post,
             x.play
            FROM post_play_ids(ARRAY( SELECT p.id
                    FROM posts p)) x
         ), on_all AS MATERIALIZED (
          SELECT i.play AS id
            FROM on_ids i
         UNION ALL
          SELECT r.r AS id
            FROM play_rider_ids(ARRAY( SELECT i.play
                    FROM on_ids i)) r(r)
         ), on_posts AS MATERIALIZED (
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
           WHERE (a.kind = ANY (ARRAY['card'::text, 'set'::text, 'spring'::text, 'take_back'::text])) AND (a.id = ANY (ARRAY( SELECT o.id
                    FROM on_all o)))
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
         ), o_ids AS MATERIALIZED (
          SELECT x.post,
             x.play
            FROM (o_on o
              CROSS JOIN LATERAL post_play_ids(ARRAY[o.id]) x)
         ), o_all AS MATERIALIZED (
          SELECT i.play AS id
            FROM o_ids i
         UNION ALL
          SELECT r.r AS id
            FROM play_rider_ids(ARRAY( SELECT i.play
                    FROM o_ids i)) r(r)
         ), o_plays AS MATERIALIZED (
          SELECT a.*
            FROM acts_public a
           WHERE (EXISTS ( SELECT 1
                    FROM o_ids x)) AND (a.kind = ANY (ARRAY['card'::text, 'set'::text, 'spring'::text, 'take_back'::text])) AND (a.id = ANY (ARRAY( SELECT o.id
                    FROM o_all o)))
         ), o_shown AS MATERIALIZED (
          SELECT s.*
            FROM o_plays s
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
             jsonb_build_object('character', jsonb_build_object('id', c.id, 'name', c.name, 'joined', c.joined, 'staff', c.staff, 'office', c.office, 'warn_points', c.warn_points, 'banned_until', c.banned_until, 'locked_until', locked_out_until(c.id, thread_page.in_thread), 'group', c."group"), 'profile', ( SELECT (jsonb_build_object('character', p."character", 'title', p.title, 'signature', p.signature, 'avatar_square', p.avatar_square, 'avatar_portrait', p.avatar_portrait, 'square_frame', p.square_frame, 'portrait_frame', p.portrait_frame, 'pip_style', p.pip_style, 'pronouns', p.pronouns) || profile_cosmetics(p."character"))
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
                FROM ( SELECT to_jsonb(o.*) AS j,
                         o.created_at,
                         o.id
                        FROM on_posts o
                     UNION ALL
                      SELECT to_jsonb(e.*) AS to_jsonb,
                         e.created_at,
                         e.id
                        FROM ends_on_posts e) x), 'counts', ( SELECT COALESCE(jsonb_agg(jsonb_build_object('post', k.post, 'card', k.card, 'all', k.plays, 'took', k.took) ORDER BY k.post, k.card NULLS FIRST), '[]'::jsonb) AS "coalesce"
                FROM post_kind_counts(ARRAY( SELECT p.id
                        FROM posts p)) k), 'above', ( SELECT COALESCE(jsonb_agg(jsonb_build_object('play', x.play, 'reach', x.reach, 'target', x.target, 'ends_at', x.ends_at, 'act', x.act) ORDER BY ((x.act ->> 'created_at'::text))::timestamp with time zone, x.play), '[]'::jsonb) AS "coalesce"
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
                                FROM o_ends e) x), 'counts', ( SELECT COALESCE(jsonb_agg(jsonb_build_object('post', k.post, 'card', k.card, 'all', k.plays, 'took', k.took) ORDER BY k.post, k.card NULLS FIRST), '[]'::jsonb) AS "coalesce"
                        FROM post_kind_counts(ARRAY( SELECT o.id
                                FROM o_on o)) k), 'moment', origin_moment(in_thread), 'at', ( SELECT jsonb_build_object('thread', (z.q ->> 'thread'::text), 'seq', ((z.q ->> 'seq'::text))::integer) AS jsonb_build_object
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
