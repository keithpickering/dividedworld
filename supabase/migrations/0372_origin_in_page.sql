-- A spun thread's page carries its origin (docs/plans/2026-11-14-origin-in-page-plan.md, Task 2; design docs/plans/2026-11-14-origin-in-page-design.md, sections 2, 3, 4 and 6).
--
-- What was found: the ORIGIN box of a thread spun from an Act asked for its content in a chain of reads after the page had arrived (the Act, its plays, their ends, the tallies, the caller's reactions, the spins, the saved states, the
-- releases, the characters, the post's place, the moment), each its own request. thread_page now answers the first of them with the page: the page that holds a spun thread's first Act carries an `origin` key, and every other page and
-- thread has none. The return shape only gains a key; nothing that was there is changed or moved.
--
--   origin.act      the origin Act as acts_public shows it (null where it is not there, which is a thread spun from an Act an import left behind).
--   origin.plays    its first 20 layer Acts (card, set, spring), oldest first, then the card_end of each of those, as cardsOn answers; origin.more says whether a 21st exists.
--   origin.moment   what play_moment or spin_moment answers, chosen as the box chooses (a play on a character spun at a post named by the place: the spin's own; else the play's), or null (origin_moment, below).
--   origin.at       { thread, seq } of the post a play is on: the pressed post of a spin at a post, else the cast-from post of a play on a character, else the post a play on a post is on; null for any other origin.
--   origin.cast     for the origin's author, each of its plays' casters and the character a play at character reach is on: the `character` and `profile` objects, and nothing else of `people`'s (no post count, standing,
--                   reveal or Turn is computed for a character with no postbit on the page).
-- The origin Act and its 20 plays join `ids`, so `tallies`, `mine` and `spun` hold their rows, and the plays whose card the instance draws an effect for join `wanted_plays`, so `states` and `releases` hold theirs. `who` is not
-- touched, so `people` holds no caster who wrote nothing on the page.
--
-- The `character` and `profile` objects of `people` and of `origin.cast` are one expression, in one CTE (`heads`), which `people` reads for the characters of `who` and `cast` reads for the characters of the origin: a later
-- migration that adds a profile field adds it in one place, and the two cannot drift apart. `people` is the same document as before (the same objects, the same order).
--
-- origin_moment(in_thread): plpgsql, stable, security invoker. The moment functions refuse by raising ("that is no play on a post", "that spin names no post"), and a raise inside thread_page would fail the page where it used to fail only
-- the box. So the page asks origin_moment, which decides from the thread's origin place (thread_open, the same row the box's own decision reads) and never by catching a refusal: a play whose place is a post is play_moment's; a play on a
-- character whose place names the pressed post is spin_moment(first Act), else play_moment's; every other origin (a post, an update, a thread's play, a board's play, a play on an update, a thread with no origin Act) is null with no
-- call. The one refusal that can still arrive (a spin whose moment row is missing; a play on a character whose cast-from post is not a post) is caught in one exception block, entered only where a moment function is called, and
-- answered null. The box then draws its head alone, as it does today. It is a helper of thread_page and the web never calls it (tools/check-web-reads.mjs, SCREEN_HELPERS).
--
-- Masks (design section 6): origin holds what acts_public, reaction_tallies, characters_public, thread_open and the two moment functions already answer to any caller, by the same rows; `mine` and `releases` are the caller's own, as they are
-- for the page's posts. Nothing is computed from who owns a character, a class, or who reacted. A veiled origin's author is the stand-in acts_public shows, so `cast` names the stand-in and never the author, and the moment is the
-- functions' own (they read the post's author through shown_author). The document's size and the read's time vary with the origin's public plays alone: at most 21 plays by target_act_id, their ends, one Act by key, one moment by key and
-- at most 23 characters by key.
--
-- A busy instance: a page with no origin runs none of it. o_on holds the origin's id only where the page's Acts hold the thread's first Act, and every added read joins o_on, so each is keyed on a value that is absent there; under the
-- generic plan (0368) the joins under an empty o_on are never executed.
--
-- Nothing is added to a player, a character or a post, so nothing is left to end ("No player is ever stuck").

create function public.origin_moment(in_thread uuid)
 returns jsonb
 language plpgsql
 stable
 set search_path to 'public', 'pg_temp'
 set plan_cache_mode = force_generic_plan
 set jit = off
as $function$
#variable_conflict use_column
declare
  t record;
  on_kind text;
  pressed boolean;
begin
  select o.origin_act_id, o.first_act, o.origin_place into t from thread_open o where o.id = origin_moment.in_thread;
  if t.origin_act_id is null or t.origin_place ->> 'kind' is distinct from 'play' then return null; end if;
  on_kind := t.origin_place #>> '{on,kind}';
  -- A play on a post, or on a character (cast from the post that is its target): the moment functions' own cases. A thread's play, a board's play and a play on an update have none.
  if on_kind is distinct from 'post' and on_kind is distinct from 'character' then return null; end if;
  pressed := on_kind = 'character' and jsonb_typeof(t.origin_place -> 'at') = 'object' and t.first_act is not null;
  begin
    if pressed then return spin_moment(t.first_act); end if;
    return play_moment(t.origin_act_id);
  exception when sqlstate 'P0002' then
    -- The functions refuse a spin with no moment row and a play whose target is no post, and the page must be answered: no moment, as the box draws one it cannot read.
    return null;
  end;
end
$function$;
revoke execute on function public.origin_moment(uuid) from public, anon;
grant execute on function public.origin_moment(uuid) to authenticated;

create or replace function public.thread_page(in_thread uuid, in_page integer, in_seq integer, per_page integer, effect_cards text[])
 returns jsonb
 language plpgsql
 stable
 set search_path to 'public', 'pg_temp'
 set plan_cache_mode = force_generic_plan
 set jit = off
as $function$
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
           WHERE (a.kind = 'post'::text)
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
            FROM characters_public c
           WHERE ((c.id IN ( SELECT w.c
                    FROM who w)) OR (c.id IN ( SELECT o.c
                    FROM o_cast o)))
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
