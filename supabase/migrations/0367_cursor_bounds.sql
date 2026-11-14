-- Cursor bounds a generic plan can seek on (docs/plans/2026-11-14-cursor-bounds-design.md, its plan, Task 3).
-- A page cursor written `<arg> is null or <column> <= <arg>` is a catch-all: a plan built before the value is known cannot drop the `is null` arm,
-- so a deep page reads every row behind the cursor and keeps a page. Each bound is rewritten as `<column> <= coalesce(<arg>, 'infinity')`, or as a row
-- comparison `(at, id) < (coalesce(before, 'infinity'), coalesce(before_id, nil uuid))` for the keyset ones, which a generic plan seeks on and which
-- returns the same rows. cosmetic_log_rows also bounds each branch on its own, since the outer limit alone reads every row behind the cursor.
-- trophy_awards gets a partial (at desc, id desc) index that only admin_awards' row comparison seeks on. trophies_of, belt_lineage and
-- admin_awards also carry the whole awards row in their page CTE, so nothing joins back to trophy_awards: with a page of unknown size a
-- generic plan hash-joined all of it. Otherwise each definition is unchanged: the same arguments, return shape, volatility, security,
-- search_path and refusals.

-- Partial on purpose, so that only admin_awards' page can use this index. An unscoped (at desc, id desc) index was picked for the `held` lookup in
-- trophy_item (`where trophy = ... order by at desc, id desc limit 1`), which then filtered away other trophies' rows; the two-belt case in 0319
-- guards it. A query can use a partial index only when its own clauses imply the predicate, so the predicate is `at > '-infinity'`: always true,
-- and said only by admin_awards. It is not `id is not null`: Postgres 17 drops an IS NOT NULL qual on a NOT NULL column before it matches
-- indexes, so that predicate could be matched by no query at all (found in CI, Postgres 17.11).
create index if not exists trophy_awards_at_id on trophy_awards (at desc, id desc) where at > '-infinity';

CREATE OR REPLACE FUNCTION public.log_page(in_before timestamp with time zone)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
BEGIN ATOMIC
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
           WHERE (l.ends_at <= COALESCE(log_page.in_before, 'infinity'))
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
           WHERE (e.at <= COALESCE(log_page.in_before, 'infinity'))
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
             c.repriced
            FROM my_card_ledger c
           WHERE (c.at <= COALESCE(log_page.in_before, 'infinity'))
           ORDER BY c.at DESC, c.card, c.kind, c.act, c.price, c.pack
          LIMIT 200
         ), pk AS MATERIALIZED (
          SELECT p.id,
             p.pack,
             p.price,
             p.repriced,
             p.contents,
             p.bought_at
            FROM my_packs p
           WHERE (p.bought_at <= COALESCE(log_page.in_before, 'infinity'))
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
           WHERE (p.at <= COALESCE(log_page.in_before, 'infinity'))
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
           WHERE (w.at <= COALESCE(log_page.in_before, 'infinity'))
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
           WHERE (r.at <= COALESCE(log_page.in_before, 'infinity'))
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
           WHERE (r.at <= COALESCE(log_page.in_before, 'infinity'))
           ORDER BY r.at DESC, r.act, r.mine
          LIMIT 200
         ), sv AS MATERIALIZED (
          SELECT p.play,
             p.post,
             p.saved_at
            FROM my_posts_played_on p
           WHERE ((p.saved_at IS NOT NULL) AND (p.saved_at <= COALESCE(log_page.in_before, 'infinity')))
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
           WHERE ((f.ended_at IS NOT NULL) AND (f.ended_at <= COALESCE(log_page.in_before, 'infinity')))
           ORDER BY f.ended_at DESC, f.play
          LIMIT 200
         ), sp AS MATERIALIZED (
          SELECT f.play,
             f.card,
             f.post,
             f.ends_at,
             f.passed_at
            FROM my_face_down f
           WHERE ((f.passed_at IS NOT NULL) AND (f.spring IS NULL) AND (f.passed_at <= COALESCE(log_page.in_before, 'infinity')))
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
           WHERE (c.at <= COALESCE(log_page.in_before, 'infinity'))
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
           WHERE (e.at <= COALESCE(log_page.in_before, 'infinity'))
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
           WHERE (i.at <= COALESCE(log_page.in_before, 'infinity'))
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
           WHERE (b.at <= COALESCE(log_page.in_before, 'infinity'))
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
           WHERE (f.at <= COALESCE(log_page.in_before, 'infinity'))
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
           WHERE (g.at <= COALESCE(log_page.in_before, 'infinity'))
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
           WHERE (r.at <= COALESCE(log_page.in_before, 'infinity'))
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
           WHERE (a.at <= COALESCE(log_page.in_before, 'infinity'))
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
         ), sa AS MATERIALIZED (
          SELECT s.settlement,
             s."character",
             s.named_class,
             s.play,
             s.card,
             s.starts_at,
             s.ends_at
            FROM my_scored_as s
           WHERE (s.ends_at <= COALESCE(log_page.in_before, 'infinity'))
           ORDER BY s.ends_at DESC, s.settlement, s."character"
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
            FROM cs x), '[]'::jsonb)), 'shares', COALESCE(( SELECT jsonb_agg(to_jsonb(x.*) ORDER BY x.settlement DESC, x."character", x.reason, x.card, x.act, x.quadrant) AS jsonb_agg
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
          LIMIT 1)) AS jsonb_build_object;
END;

CREATE OR REPLACE FUNCTION public.cosmetic_log_rows(in_before timestamp with time zone DEFAULT NULL::timestamp with time zone, most integer DEFAULT 200)
 RETURNS TABLE(kind text, id text, at timestamp with time zone, "character" uuid, outcome text, item text, text text, copies integer, trophy text, name text, by text, by_name text, season integer, place integer, line text, to_name text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select u.* from (
  (select 'found'::text as kind, e.id::text as id, e.at, e.character, e.outcome, e.item, e.line_text as text, null::integer as copies,
         null::text as trophy, null::text as name, null::text as by, null::text as by_name, null::integer as season, null::integer as place, null::text as line, null::text as to_name
  from random_events e where e.account = auth.uid() and (e.at <= coalesce(in_before, 'infinity'))
   order by e.at desc, e.id::text limit least(greatest(most, 0), 1000))
  union all
  (select 'granted', min(g.id)::text, g.at, g.through, null, g.gear, null, count(*)::integer,
         null, null, null, null, null, null, null, null
  from gear_ledger g where g.kind = 'granted' and g.account = auth.uid() and (g.at <= coalesce(in_before, 'infinity')) group by g.at, g.gear, g.through
   order by g.at desc, min(g.id)::text limit least(greatest(most, 0), 1000))
  union all
  (select 'awarded', a.id::text, a.at, a.character, null, null, null, null,
         a.trophy, k.name, a.by, (select c.name from acts x join characters c on c.id = x.character where x.id = a.act and a.by = 'boss'),
         (select s.number::integer from seasons s where s.id = a.season), k.season_place::integer, a.line, null
  from trophy_awards a join trophy_kinds k on k.key = a.trophy join characters o on o.id = a.character
  where o.owner = auth.uid() and (a.at <= coalesce(in_before, 'infinity'))
   order by a.at desc, a.id::text limit least(greatest(most, 0), 1000))
  union all
  (select 'reversed', a.id::text, r.at, a.character, null, null, null, null,
         a.trophy, k.name, null, null, null, null, null, null
  from trophy_reversals r join trophy_awards a on a.id = r.award join trophy_kinds k on k.key = a.trophy join characters o on o.id = a.character
  where o.owner = auth.uid() and (r.at <= coalesce(in_before, 'infinity'))
   order by r.at desc, a.id::text limit least(greatest(most, 0), 1000))
  union all
  (select 'lost', n.id::text, n.at, p.character, null, null, null, null,
         n.trophy, k.name, n.by, (select c.name from acts x join characters c on c.id = x.character where x.id = n.act and n.by = 'boss'),
         null, null, null, nc.name
  from trophy_awards n
  join trophy_kinds k on k.key = n.trophy and k.belt
  join characters nc on nc.id = n.character
  cross join lateral (select x.character from trophy_awards x
                      where x.trophy = n.trophy and (x.at, x.id) < (n.at, n.id) and not exists (select 1 from trophy_reversals r where r.award = x.id and r.at <= n.at)
                      order by x.at desc, x.id desc limit 1) p
  join characters o on o.id = p.character
  where o.owner = auth.uid() and (n.at <= coalesce(in_before, 'infinity')) and p.character <> n.character
    and n.trophy in (select a.trophy from trophy_awards a join characters c on c.id = a.character where c.owner = auth.uid())
   order by n.at desc, n.id::text limit least(greatest(most, 0), 1000))
  union all
  (-- The belt that came back: an admin took the holder's award back, and the character that held it before holds it again. Said as of the reversal, so a later one changes nothing of it.
  select 'beltBack', x.id::text, rv.at, h.character, null, null, null, null,
         x.trophy, k.name, null, null, null, null, null, xc.name
  from trophy_reversals rv
  join trophy_awards x on x.id = rv.award
  join trophy_kinds k on k.key = x.trophy and k.belt
  join characters xc on xc.id = x.character
  cross join lateral (select y.character from trophy_awards y
                      where y.trophy = x.trophy and y.id <> x.id and (y.at, y.id) < (x.at, x.id) and not exists (select 1 from trophy_reversals r where r.award = y.id and r.at <= rv.at)
                      order by y.at desc, y.id desc limit 1) h
  join characters o on o.id = h.character
  where o.owner = auth.uid() and (rv.at <= coalesce(in_before, 'infinity')) and h.character <> x.character
    and x.trophy in (select a.trophy from trophy_awards a join characters c on c.id = a.character where c.owner = auth.uid())
    and not exists (select 1 from trophy_awards z
                    where z.trophy = x.trophy and z.id <> x.id and (z.at, z.id) > (x.at, x.id) and z.at <= rv.at and not exists (select 1 from trophy_reversals r where r.award = z.id and r.at <= rv.at))
   order by rv.at desc, x.id::text limit least(greatest(most, 0), 1000))
  ) u order by u.at desc, u.kind, u.id limit least(greatest(most, 0), 1000);
$function$;

CREATE OR REPLACE FUNCTION public.trophies_of(of_character uuid, before timestamp with time zone DEFAULT NULL::timestamp with time zone, most integer DEFAULT 50, before_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  with page as (
    select a as aw, row_number() over (order by a.at desc, a.id desc) as n from trophy_awards a
    where a.character = of_character
      and ((a.at, a.id) < (coalesce(before, 'infinity'), coalesce(before_id, '00000000-0000-0000-0000-000000000000'::uuid)))
      and not exists (select 1 from trophy_reversals r where r.award = a.id)
    order by a.at desc, a.id desc
    limit least(greatest(coalesce(most, 50), 1), 100) + 1
  )
  select jsonb_build_object(
    'awards', coalesce((select jsonb_agg(trophy_item(p.aw) order by p.n) from page p where p.n <= least(greatest(coalesce(most, 50), 1), 100)), '[]'::jsonb),
    'more', exists (select 1 from page p where p.n > least(greatest(coalesce(most, 50), 1), 100)))
$function$;

CREATE OR REPLACE FUNCTION public.belt_lineage(trophy_key text, before timestamp with time zone DEFAULT NULL::timestamp with time zone, most integer DEFAULT 20, before_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  is_belt boolean;
  size integer := least(greatest(coalesce(most, 20), 1), 100);
begin
  select k.belt into is_belt from trophy_kinds k where k.key = trophy_key;
  if is_belt is null then raise exception 'there is no trophy "%"', trophy_key using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
  if not is_belt then raise exception '"%" is not a belt', trophy_key using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  return (
    with page as (
      select a as aw, row_number() over (order by a.at desc, a.id desc) as n from trophy_awards a
      where a.trophy = trophy_key
        and ((a.at, a.id) < (coalesce(before, 'infinity'), coalesce(before_id, '00000000-0000-0000-0000-000000000000'::uuid)))
        and not exists (select 1 from trophy_reversals r where r.award = a.id)
      order by a.at desc, a.id desc
      limit size + 1
    )
    select jsonb_build_object(
      'reigns', coalesce((select jsonb_agg(jsonb_build_object('award', (p.aw).id, 'character', (p.aw).character, 'name', c.name, 'began', (p.aw).at, 'by', trophy_given_by(p.aw),
                            'ended', (select x.at from trophy_awards x where x.trophy = trophy_key and (x.at, x.id) > ((p.aw).at, (p.aw).id)
                                        and not exists (select 1 from trophy_reversals r where r.award = x.id) order by x.at, x.id limit 1)) order by p.n)
                          from page p join characters c on c.id = (p.aw).character where p.n <= size), '[]'::jsonb),
      'more', exists (select 1 from page p where p.n > size)));
end $function$;

CREATE OR REPLACE FUNCTION public.admin_awards(before timestamp with time zone DEFAULT NULL::timestamp with time zone, most integer DEFAULT 20, before_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  size integer := least(greatest(coalesce(most, 20), 1), 100);
begin
  perform only_admins('reads the trophies given');
  return (
    with page as (
      select a as aw, row_number() over (order by a.at desc, a.id desc) as n from trophy_awards a
      -- `a.at > '-infinity'` is always true; it lets this page, and no other read, use the partial index trophy_awards_at_id.
      where a.at > '-infinity'::timestamptz and (a.at, a.id) < (coalesce(before, 'infinity'), coalesce(before_id, '00000000-0000-0000-0000-000000000000'::uuid))
      order by a.at desc, a.id desc
      limit size + 1
    )
    select jsonb_build_object(
      'awards', coalesce((select jsonb_agg(jsonb_build_object('award', (p.aw).id, 'trophy', (p.aw).trophy, 'name', k.name, 'art', k.art, 'belt', k.belt, 'character', (p.aw).character, 'to', c.name,
                            'by', trophy_given_by(p.aw), 'at', (p.aw).at, 'line', (p.aw).line,
                            'reversed', exists (select 1 from trophy_reversals r where r.award = (p.aw).id)) order by p.n)
                          from page p join trophy_kinds k on k.key = (p.aw).trophy join characters c on c.id = (p.aw).character where p.n <= size), '[]'::jsonb),
      'kinds', coalesce((select jsonb_agg(jsonb_build_object('key', k.key, 'name', k.name, 'belt', k.belt, 'made', k.made_by is not null, 'art', k.art) order by k.name, k.key) from trophy_kinds k), '[]'::jsonb),
      'more', exists (select 1 from page p where p.n > size)));
end $function$;

CREATE OR REPLACE FUNCTION public.staff_notes_recent(of_staff text, since timestamp with time zone, most integer)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select coalesce(jsonb_agg(n.body order by n.at, n.id), '[]'::jsonb)
  from (
    select s.body, s.at, s.id from staff_notes s
    where s.staff = of_staff and (s.at > coalesce(since, '-infinity'))
    order by s.at desc, s.id desc
    limit greatest(coalesce(most, 0), 0)
  ) n
$function$;
