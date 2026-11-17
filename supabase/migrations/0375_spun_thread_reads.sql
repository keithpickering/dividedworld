-- The reads of a spun thread's opening post ask what a card's writes ask (docs/plans/2026-11-16-cards-on-a-spun-thread-plan.md, Task 2; design docs/plans/2026-11-16-cards-on-a-spun-thread-design.md, sections 1 to 3, 5 and 7).
--
-- What was found (section 1): 0374 lets a card land on the opening post of a spun thread, whose opening Act is a `spin`. A play that has landed there is then drawn nowhere, because each read of a post's plays asked
-- "is this Act a post?" by comparing its kind with 'post' by hand, and a spin is not that kind: the thread's page held no play, face-down card, saved state, reply or veil on its first post (thread_page's `page_posts`), a play's
-- moment was refused ("that is no play on a post"; play_moment), and so a thread spun from that play had no origin moment; a character card cast from the opening post reached no thread or board above it
-- (card_target_reach); the author's log lost the end of a play on the opening post and a written tail on it (my_cards_ended, my_posts_written_on); an author veil on it moved a post from its author's count where the
-- author had written a spin (character_veiled_counts); and a writing play on a reply was not handed the opening post's words (claim_card_writes' `before`).
--
-- The rule (section 3), as 0374 stated it: the opening post is a post for every card, and "is a post" is the one predicate post_kind. Each of these reads asks it. Nothing here writes a row but one fill (step 6): the kind of each existing veil's post, in a column the veil's row gains.
--
--   1. post_kind          granted to authenticated, the role that runs it where thread_page (a security invoker) and the two views below call it.
--   2. thread_page        page_posts takes post_kind. The `cut` list (replies cut from the page, `d.kind = 'post'`) stays.
--   3. play_moment        a play on a post asks post_kind.
--   4. card_target_reach  the character branch's pressed post asks post_kind.
--   5. my_cards_ended, my_posts_written_on   the caller's own posts ask post_kind.
--   6. the counts         character_veiled_counts gains `spins` (and `posts` is 1 only for a post); carried through character_count_moves into character_counts_shown. The veiled Act's kind is read from
--                         post_veils.post_kind (a new column, set by a trigger when the veil is written, carried by post_veils_live), so a count read probes no Act for it.
--   7. claim_card_writes  the `before` read asks post_kind.
-- Each function and view is copied whole from its latest body, with only the named lines changed. Their owners, options and grants are stated again.
--
-- A busy instance: a read's cost grows by one function call per row it filters. post_kind is an immutable one-expression function (`kind in ('post', 'spin')`) called where each read had `kind = 'post'`; the planner does not inline it, because its search_path is pinned. The reads find their rows by thread and seq (or by id) first, so it filters a page's rows, never a table's; the three reads that probe by index (the page's Acts by
-- thread and seq, the caller's posts by character) still do, with a two-value filter on the kind.
--
-- Ways out: no state is added. Masks: a spin's author is as public as a post's (acts_public shows both under the stand-in while a veil is up), and the counts move what acts_public shows, for every reader alike.


-- ---- 1. post_kind, where a security invoker runs it ----
--
-- thread_page is a security invoker (0094), so post_kind below runs as the signed-in player's role, as it does where my_cards_ended and my_posts_written_on call it (a function a view calls is run as the role that reads the view, whatever the view's own options), and 0374 revoked it from that role (no client calls it as an RPC). It is granted to authenticated and to no
-- other API role, and is added to supabase/tests/0005-default-deny.sql's list with this reason. It reads nothing and takes one text, so it says nothing about anyone. It is not made a definer: a definer runs with its
-- owner's rights, and nothing here needs them.

grant execute on function post_kind(text) to authenticated;

-- ---- 2. thread_page ----
--
-- `page_posts` reads the page's Acts that are posts: `post_kind(a.kind)` where 0372 wrote `a.kind = 'post'`, so the opening post of a spun thread (a `spin` Act) is a page post. `nested`, `posts`, `on_posts`, `played`,
-- `veiled`, `above` and `kept` derive from page_posts, so each follows with no change of its own. The `cut` list (`d.kind = 'post'`) stays: it is about replies cut from the page.
-- Everything else as 0372_origin_in_page.sql wrote it.
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
                    FROM o_cast o) k(id)
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
                        FROM ids i))), 'spun', ( SELECT COALESCE(jsonb_agg((to_jsonb(l.*) - 'n'::text) ORDER BY l.created_at, l.id), '[]'::jsonb) AS "coalesce"
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
                                     ELSE NULL::jsonb
                                 END AS q
                                FROM rng r) z
                       WHERE (jsonb_typeof(z.q) = 'object'::text)), 'cast', ( SELECT COALESCE(jsonb_agg(h.head ORDER BY h.id), '[]'::jsonb) AS "coalesce"
                        FROM heads h
                       WHERE (h.id IN ( SELECT o.c
                                FROM o_cast o)))))
                 ELSE '{}'::jsonb
             END
         END AS jsonb_build_object
  );
end
$function$;

revoke execute on function public.thread_page(uuid, integer, integer, integer, text[]) from public, anon, authenticated, service_role;
grant execute on function public.thread_page(uuid, integer, integer, integer, text[]) to authenticated, service_role;

-- ---- 3. play_moment ----
--
-- A play on a post: `not coalesce(post_kind(on_post.kind), false)` where 0357 wrote `on_post.kind is distinct from 'post'` (a target that is not there has no kind and is refused as before). For a spin target the
-- version is the spin's own id (post_version), and act_projection already answers a spin. Everything else as 0357_post_veils.sql wrote it.
CREATE OR REPLACE FUNCTION public.play_moment(play uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET plan_cache_mode TO 'force_generic_plan'
 SET jit TO 'off'
AS $function$
declare
  k acts%rowtype;
  on_post acts%rowtype;
  v acts%rowtype;
  recorded boolean;
  on_board uuid;
  grace interval := coalesce(span_interval((select g.value from settings g where g.key = 'editGrace')), interval '0');
  -- A play beyond a post that began before this one ends at most its reach's reachLasts after it began (play_card), so before this
  -- play's time plus that bound: each probe of play_reach reads the plays live then and none begun since, however old the play is.
  -- (An instance that lowers reachLasts later bounds an older moment by the lower span; a play that outlived it is left off that
  -- moment's list of plays above, which is words on the frame.)
  bound record;
begin
  select * into k from acts a where a.id = play_moment.play;
  -- A play on a post, or on a character (cast from the post that is its target_act_id). A thread's and a board's play are no play on a post.
  if k.id is not null and k.kind in ('card', 'set', 'spring') and k.target_act_id is not null and coalesce(k.payload ->> 'reach', 'post') in ('post', 'character') then
    select * into on_post from acts a where a.id = k.target_act_id;
  end if;
  if not coalesce(post_kind(on_post.kind), false) then raise exception 'that is no play on a post' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
  -- The post's author as the projection shows it: the plays above are those at the character shown, so a post whose author is hidden has none at its author's reach.
  on_post.character := shown_author(on_post.id, on_post.character);
  select * into v from acts a where a.id = (select m.post_version from play_moments m where m.play = k.id);
  recorded := v.id is not null;
  if not recorded then
    select * into v from acts e where e.kind = 'edit' and e.target_act_id = on_post.id and e.created_at <= k.created_at
    order by e.created_at desc, e.id desc limit 1;
    if v.id is null then v := on_post; end if;
  end if;
  select t.board into on_board from threads t where t.id = on_post.thread;
  -- An instance seeded without reachLasts (settings_reach_hold makes it whole once written) bounds nothing, rather than reading none.
  select coalesce(span_interval(setting('reachLasts') -> 'character'), interval '1000 months') as character,
         coalesce(span_interval(setting('reachLasts') -> 'thread'), interval '1000 months') as thread,
         coalesce(span_interval(setting('reachLasts') -> 'board'), interval '1000 months') as board into bound;
  return jsonb_build_object(
    'version', act_projection(on_post.id) || jsonb_build_object(
      'current_payload', public_payload(v.payload, version_hidden(v.id), v.id),
      'edited_at', case when v.kind = 'edit' then v.created_at end,
      'shown_edited_at', case when v.kind = 'edit' and v.created_at > on_post.created_at + grace then v.created_at end),
    -- The rows' order is for a stable answer only: a caught play and its spring share a transaction's time, so readers order the layers
    -- themselves (inPlayOrder) and find a caught play's spring by its set, never by this order.
    'layers', jsonb_build_array(jsonb_build_object('act', act_projection(k.id), 'state', null, 'savedAt', null))
      || coalesce((select jsonb_agg(jsonb_build_object('act', to_jsonb(a), 'state', l.state, 'savedAt', l.saved_at) order by a.created_at, a.id)
                   from play_moment_layers l join acts_public a on a.id = l.layer where l.play = k.id), '[]'::jsonb)
      || coalesce((select jsonb_agg(jsonb_build_object('act', to_jsonb(e), 'state', null, 'savedAt', null) order by e.created_at, e.id)
                   from acts_public e
                   where e.kind = 'card_end' and e.created_at <= k.created_at
                     and e.target_act_id in (select k.id union all select l.layer from play_moment_layers l where l.play = k.id)), '[]'::jsonb),
    'above', coalesce((
      select jsonb_agg(jsonb_build_object('play', r.play, 'reach', r.reach, 'target', coalesce(r.character, r.thread, r.board), 'ends_at', r.ends_at, 'act', to_jsonb(a))
                       order by a.created_at, a.id)
      from (
        select x.* from play_reach x where x.character = on_post.character and x.ends_at > k.created_at and x.ends_at <= k.created_at + bound.character
        union all
        select x.* from play_reach x where x.thread = on_post.thread and x.ends_at > k.created_at and x.ends_at <= k.created_at + bound.thread
        union all
        select x.* from play_reach x where x.board = on_board and x.ends_at > k.created_at and x.ends_at <= k.created_at + bound.board
      ) r join acts_public a on a.id = r.play
      where a.created_at < k.created_at
        and not exists (select 1 from acts e where e.kind = 'card_end' and e.target_act_id = r.play and e.created_at <= k.created_at)), '[]'::jsonb),
    'recorded', recorded,
    'at', k.created_at);
end $function$;

revoke execute on function public.play_moment(uuid) from public, anon, authenticated, service_role;
grant execute on function public.play_moment(uuid) to authenticated, service_role;

-- ---- 4. card_target_reach ----
--
-- The character branch reads the post a character card is cast from: `post_kind(a.kind)` where 0361 wrote `a.kind = 'post'`. Everything else as 0361_discipline_cards.sql wrote it.
CREATE OR REPLACE FUNCTION public.card_target_reach(reach text, target uuid, from_post uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  got jsonb;
  t_thread uuid;
  t_board uuid;
  t_character uuid;
begin
  if reach = 'post' then
    got := card_target(target);
    if got is null then return null; end if;
    select shown_author(a.id, a.character), a.thread, th.board into t_character, t_thread, t_board from acts a join threads th on th.id = a.thread where a.id = target;
    return got || jsonb_build_object('above', jsonb_strip_nulls(jsonb_build_object(
      'character', case when t_character is not null then reach_effects('character', t_character) end,
      'thread', reach_effects('thread', t_thread), 'board', reach_effects('board', t_board))));
  elsif reach = 'character' then
    if not exists (select 1 from characters c where c.id = target) then return null; end if;
    select a.thread, th.board into t_thread, t_board from acts_public a join threads th on th.id = a.thread
    where a.id = from_post and post_kind(a.kind) and a.character = target;
    return jsonb_build_object('reach', 'character', 'character', target, 'effects', reach_effects('character', target),
      'warnPoints', warn_points(target), 'bannedUntil', banned_until(target),
      'above', jsonb_strip_nulls(jsonb_build_object('thread', case when t_thread is not null then reach_effects('thread', t_thread) end,
                                                    'board', case when t_board is not null then reach_effects('board', t_board) end)));
  elsif reach = 'thread' then
    select th.board into t_board from threads th where th.id = target;
    if t_board is null then return null; end if;
    return jsonb_build_object('reach', 'thread', 'thread', target, 'effects', reach_effects('thread', target),
      'above', jsonb_build_object('board', reach_effects('board', t_board)));
  elsif reach = 'board' then
    if not exists (select 1 from boards b where b.id = target) then return null; end if;
    return jsonb_build_object('reach', 'board', 'board', target, 'effects', reach_effects('board', target), 'above', '{}'::jsonb);
  end if;
  return null;
end $function$;

revoke execute on function public.card_target_reach(text, uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.card_target_reach(text, uuid, uuid) to authenticated, service_role;

-- ---- 5. my_cards_ended and my_posts_written_on ----
--
-- Each joins the caller's own posts: `post_kind(p.kind)` where each wrote `p.kind = 'post'`, so a play on the opening post of a spun thread the caller's character wrote is an `onMine` line of the log, and a text
-- written on it a tail in the log. Everything else as 0357_post_veils.sql (my_cards_ended) and 0344_writes_start_from_the_caller.sql (my_posts_written_on) wrote them. Neither view is a security invoker (0357 made
-- my_cards_ended one that is not), so their tables are read with the view's owner's rights; post_kind, a function the view calls, is run as the role that reads the view (0357 says the same of its functions), which is why section 1 grants it to authenticated. create or replace keeps each view's owner, options and grants, so none is stated again.
create or replace view my_cards_ended as
  with mine as (select c.id from characters c where c.owner = auth.uid()),
  plays as (
    select e.id as card_end, k.id as play, k.payload ->> 'card' as card, e.created_at as at, 'cast'::text as side,
           k.character as caster, coalesce(pr.reach, 'post') as reach, k.target_act_id, k.payload ->> 'targetName' as named,
           pr.character as reach_character, pr.thread as reach_thread, pr.board as reach_board, k.character as mine_character
    from mine
    join acts k on k.character = mine.id and k.kind = 'card'
    join acts e on e.target_act_id = k.id and e.kind = 'card_end'
    left join play_reach pr on pr.play = k.id
    where pr.play is not null or coalesce(k.payload ->> 'reach', 'post') = 'post'
    union all
    select e.id, k.id, k.payload ->> 'card', e.created_at, 'onMine', k.character, 'post', k.target_act_id, null, null, null, null, p.character
    from mine
    join acts p on p.character = mine.id and post_kind(p.kind)
    join acts k on k.target_act_id = p.id and k.kind = 'card'
    join acts e on e.target_act_id = k.id and e.kind = 'card_end'
    where coalesce(k.payload ->> 'reach', 'post') = 'post' and not exists (select 1 from play_reach x where x.play = k.id)
      and k.character not in (select id from mine)
    union all
    select e.id, k.id, k.payload ->> 'card', e.created_at, 'onMine', k.character, 'character', k.target_act_id, k.payload ->> 'targetName', pr.character, null, null, pr.character
    from mine
    join play_reach pr on pr.character = mine.id
    join acts k on k.id = pr.play and k.kind = 'card'
    join acts e on e.target_act_id = k.id and e.kind = 'card_end'
    where k.character not in (select id from mine)
    union all
    select e.id, k.id, k.payload ->> 'card', e.created_at, 'onMine', k.character, 'thread', k.target_act_id, k.payload ->> 'targetName', null, pr.thread, null, o.character
    from mine
    join acts o on o.character = mine.id and o.seq = 1
    join play_reach pr on pr.thread = o.thread
    join acts k on k.id = pr.play and k.kind = 'card'
    join acts e on e.target_act_id = k.id and e.kind = 'card_end'
    where k.character not in (select id from mine)
  )
  select pl.card_end, pl.play, pl.card, pl.at, pl.side, pl.reach,
         case pl.reach
           when 'character' then coalesce(pl.named, (select cp.name from characters_public cp where cp.id = pl.reach_character))
           when 'thread' then coalesce(pl.named, (select th.title from threads th where th.id = pl.reach_thread))
           when 'board' then coalesce(pl.named, (select bd.name from boards bd where bd.id = pl.reach_board))
         end as target_name,
         case when pl.reach = 'post' then (select cp.name from acts pa join characters_public cp on cp.id = case when exists (select 1 from post_veils_live sv where sv.post = pa.id and sv.veil = 'author') then (select sk.id from characters sk where sk.staff_kind = 'anonymous') else pa.character end where pa.id = pl.target_act_id) end as post_author_name,
         case when pl.side = 'cast' then (select cp.name from characters_public cp where cp.id = pl.caster)
              else (select cp.name from acts_public ap join characters_public cp on cp.id = ap."character" where ap.id = pl.play) end as caster_name,
         pl.mine_character as character
  from plays pl;

create or replace view my_posts_written_on as
  select x.play, k.post, x.version, (x.failed is not null) as failed,
         not exists (select 1 from card_texts y where y.play = x.play and y.id < x.id and y.text is not null) as opening,
         (x.failed is not null and exists (select 1 from card_write_refunds r where r.play = x.play)
            and not exists (select 1 from card_texts y where y.play = x.play and y.id > x.id)) as over,
         x.created_at as at
  from characters c
  cross join lateral (select p.id from acts p where p.character = c.id and post_kind(p.kind) offset 0) p
  cross join lateral (select k.id, k.kind, k.target_act_id as post from acts k where k.target_act_id = p.id and k.kind in ('card', 'set', 'spring') and coalesce(k.payload ->> 'reach', 'post') = 'post' offset 0) k
  cross join lateral (select x.* from card_texts x where x.play = k.id offset 0) x
  where c.owner = auth.uid() and k.kind = 'card';

-- ---- 6. the counts ----
--
-- A veiled opening post is a spin, and character_veiled_counts (0357) counted every veiled post as a post: `1 as posts`. The stored count (character_post_counts_base) counts a post as a post and a spin as a spin
-- (acts_count_character), and acts_public shows a veiled spin under the stand-in as it shows a veiled post, so the count must move the one it counts. `posts` is now 1 where the veiled Act is a post, and `spins` is 1
-- where it is a spin: a column added last, as create or replace view takes it, carried by character_count_moves into character_counts_shown's `spins` (which had stored `b.spins` as it was, and 0 for the stand-in with no
-- stored row). character_post_counts reads character_counts_shown by the same columns as before, so nothing downstream is re-created. The three views are re-created in dependency order, each with its grants as
-- 0357 stated them. A profile list and its count are still one figure: what is moved is what acts_public shows under the stand-in.
--
-- Where the kind comes from. A join of the view to acts by the veiled post's id is the plain way, and it costs a probe of acts per live veil at every read of the view: a count read reads the view three times (the author's
-- minus, the stand-in's plus, and the stand-in's row with no stored count), so a read of two counts probed acts about 27 times and touched 169 to 244 buffers where it touched 84 (0304-post-veils.sql bounds it at 130), and
-- as a hash join the planner reads every Act. A veil's post never changes kind (an Act is never edited), so the veil's own row keeps it: post_veils.post_kind, set when the row is written by a trigger that reads the one Act
-- (the two functions that write the row, land_rows in 0357 and in 0359, are as they were and name no column), and carried by post_veils_live. The count then reads no Act for it. The rows that exist are filled from their
-- posts; the append-only trigger is off for that one fill, and on again before anything else runs.
alter table post_veils add column post_kind text;
alter table post_veils disable trigger post_veils_no_update;
update post_veils v set post_kind = (select a.kind from acts a where a.id = v.post);
alter table post_veils enable always trigger post_veils_no_update;
alter table post_veils alter column post_kind set not null;
create function post_veils_kind() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  new.post_kind := coalesce(new.post_kind, (select a.kind from acts a where a.id = new.post));
  return new;
end $$;
create trigger post_veils_kind before insert on post_veils for each row execute function post_veils_kind();
revoke execute on function post_veils_kind() from public, anon, authenticated, service_role;

create or replace view post_veils_live as
  select v.play, v.post, v.veil, v.author, v.caster_account, v.ends_at, v.post_kind
  from post_veils v
  where v.ends_at > now()
    and not exists (select 1 from acts e where e.kind = 'card_end' and e.target_act_id = v.play)
    and not exists (select 1 from card_write_refunds r where r.play = v.play);
revoke all on post_veils_live from public, anon, authenticated, service_role;

create or replace view character_veiled_counts as
  select v.author, (case when v.post_kind = 'post' then 1 else 0 end) as posts,
         ((select count(*) from acts k where k.kind = 'card' and k.target_act_id = v.post and k.character = v.author)
          + (select count(*) from post_veil_cards c join acts k on k.id = c.card
             where c.post = v.post and c.author = v.author
               and not exists (select 1 from post_veils_live w where w.veil = 'author' and w.post = k.target_act_id and w.author = c.author)))::integer as cards,
         (case when v.post_kind = 'spin' then 1 else 0 end) as spins
  from (select distinct l.post, l.author, l.post_kind from post_veils_live l where l.veil = 'author') v;

create or replace view character_count_moves as
  select s.character, sum(s.posts)::integer as posts, sum(s.cards)::integer as cards, sum(s.spins)::integer as spins
  from (
    select v.author as character, -v.posts as posts, -v.cards as cards, -v.spins as spins from character_veiled_counts v
    union all
    select (select k.id from characters k where k.staff_kind = 'anonymous') as character, v.posts, v.cards, v.spins from character_veiled_counts v
  ) s
  group by s.character;

create or replace view character_counts_shown as
  select u.character, u.posts, u.spins, u.cards
  from (
    select b.character, b.posts + coalesce(m.posts, 0) as posts, b.spins + coalesce(m.spins, 0) as spins, b.cards + coalesce(m.cards, 0) as cards
    from character_post_counts_base b
    left join character_count_moves m on m.character = b.character
    union all
    select m.character, m.posts, m.spins, m.cards
    from character_count_moves m
    where m.character = (select k.id from characters k where k.staff_kind = 'anonymous')
      and not exists (select 1 from character_post_counts_base b where b.character = m.character)
  ) u;

revoke all on character_veiled_counts, character_count_moves, character_counts_shown from public, anon, authenticated, service_role;

-- ---- 7. claim_card_writes ----
--
-- The `before` read hands the model the posts above the target: `post_kind(n.kind)` where 0357 wrote `n.kind = 'post'`, so the opening post of a spun thread is among them. Everything else as 0357_post_veils.sql wrote it.
CREATE OR REPLACE FUNCTION public.claim_card_writes(most integer, only_post uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  nearby integer := coalesce((((select s.value from settings s where s.key = 'pool') ->> 'chatterThreadPosts'))::integer, 8);
  claimed jsonb;
begin
  delete from card_writes w where w.play in (
    select x.play from card_writes x where card_ended(x.play) and (claim_card_writes.only_post is null or x.post = claim_card_writes.only_post) for update skip locked);
  with picked as materialized (
    select c.play from card_writes c join acts a on a.id = c.play
    where (c.claimed_until is null or c.claimed_until < clock_timestamp()) and c.not_before <= clock_timestamp() and not card_ended(c.play)
      and (claim_card_writes.only_post is null or c.post = claim_card_writes.only_post)
      and not exists (select 1 from card_writes e join acts ea on ea.id = e.play
                      where e.post = c.post and e.play <> c.play and not card_ended(e.play) and (ea.created_at, ea.id) < (a.created_at, a.id))
    order by c.queued_at, c.play limit greatest(claim_card_writes.most, 0) for update of c skip locked
  ), taken as (
    update card_writes w set claimed_until = clock_timestamp() + interval '5 minutes', attempts = w.attempts + 1, version = post_version(w.post)
    from picked where w.play = picked.play
    returning w.play, w.post, w.version, w.attempts, w.queued_at
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'play', t.play, 'version', t.version, 'post', t.post, 'thread', pa.thread, 'attempts', t.attempts,
      'card', pl.payload ->> 'card', 'config', coalesce(pl.payload -> 'config', '{}'::jsonb), 'tokens', (pl.payload ->> 'tokens')::integer,
      'author', ch.name, 'body', own_words(case when version_hidden(v.id, pa.id) then null else v.payload ->> 'body' end), 'title', th.title,
      'before', (select coalesce(jsonb_agg(jsonb_build_object('name', x.name, 'body', x.body) order by x.seq), '[]'::jsonb)
                 from (select n.seq, cn.name,
                              own_words(case when n.hidden then null else coalesce((select e.payload ->> 'body' from acts e where e.kind = 'edit' and e.target_act_id = n.id order by e.created_at desc, e.id desc limit 1), na.payload ->> 'body') end) as body
                       from acts_public n join acts na on na.id = n.id join characters_public cn on cn.id = n.character
                       where n.thread = pa.thread and post_kind(n.kind) and n.seq < pa.seq
                       order by n.seq desc limit greatest(nearby, 0)) x),
      'earlier', (select coalesce(jsonb_agg(jsonb_build_object('play', q.id, 'text', q.text) order by q.created_at, q.id), '[]'::jsonb)
                  from (select ea.id, ea.created_at,
                          coalesce((select x.text from card_texts x where x.play = ea.id and x.version = t.version and x.text is not null),
                                   (select x.text from card_texts x where x.play = ea.id and x.text is not null order by x.created_at desc, x.id desc limit 1)) as text
                        from live_writing_plays(t.post) lp join acts ea on ea.id = lp
                        where (ea.created_at, ea.id) < (pl.created_at, pl.id)) q
                  where q.text is not null)
    ) order by t.queued_at, t.play), '[]'::jsonb) into claimed
  from taken t
  join acts pl on pl.id = t.play
  join acts pa on pa.id = t.post
  join characters ch on ch.id = shown_author(pa.id, pa.character)
  join threads th on th.id = pa.thread
  join acts v on v.id = t.version;
  return claimed;
end $function$;

revoke execute on function public.claim_card_writes(integer, uuid) from public, anon, authenticated, service_role;
grant execute on function public.claim_card_writes(integer, uuid) to service_role;
