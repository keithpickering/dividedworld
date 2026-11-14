-- Every stable function the client calls keeps one generic plan (docs/plans/2026-11-13-plan-once-design.md, sections 1 to 4).
--
-- Since 0357 the view acts_public is a union of two selects, each with its own subqueries, and a page reads it many times (thread_page: 17). A `language sql` function is planned
-- again on every call, so a thread page spent about 200 ms planning and 18 ms running. A `plpgsql` function with `plan_cache_mode = force_generic_plan` plans each statement once
-- per database connection, with no argument's value and the same for every caller.
--
-- Every one also sets `jit = off`. A kept plan is not kept with its JIT output, so a plan that costs more than jit_above_cost (100000 by default) is compiled again on every call: at about
-- 200 thousand Acts thread_page plans just above that line and spent about 2 s compiling a 15 ms read. A busy instance's thread page is always there.
--
-- Part 1 writes again, as `plpgsql`, each stable function in ALLOWED_RPCS (tools/check-web-reads.mjs) that was `language sql`: today's definition (pg_get_functiondef on a database
-- with every migration applied), the same arguments, return type, volatility, security and search_path, with `#variable_conflict use_column` so that a name that is both a variable
-- (a parameter, a column of `returns table`) and a column means the column, as it did in SQL. A `begin atomic` body's last statement is returned and a statement before it is performed.
-- log_page and trophies_of are taken as 0367_cursor_bounds.sql leaves them (coalesce(..., 'infinity') bounds, row comparisons, trophies_of's page CTE carrying the awards row); belt_lineage and admin_awards
-- are already plpgsql there and keep their bodies in Part 2.
-- Part 2 sets the plan and jit on the stable client reads that were already `plpgsql`. Grants are kept by `create or replace` and `alter`, and none is restated.
-- supabase/tests/0320-client-reads-plan-once.sql names any client read that is not planned once.

-- ---- 1. Written again as plpgsql ----

create or replace function public.admin_contact()
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public', 'pg_temp'
 set plan_cache_mode = force_generic_plan
 set jit = off
as $function$
#variable_conflict use_column
begin
  return (
  select coalesce((select s.value from settings s where s.key = 'adminContact' and jsonb_typeof(s.value) = 'array'), '[]'::jsonb)
  );
end
$function$;

create or replace function public.alerts_page(in_before timestamp with time zone)
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
  WITH RECURSIVE al AS (
          SELECT (to_jsonb(a.*) - 'ordinality'::text) AS j,
             a.ordinality AS o
            FROM my_alerts(alerts_page.in_before, 30) WITH ORDINALITY a(kind, sub, act, "character", at, thread, name, title, count, ordinality)
         ), chain(id, depth, ended) AS (
          SELECT ((al.j ->> 'act'::text))::uuid AS uuid,
             1 AS "?column?",
             ((al.j ->> 'kind'::text) = 'cardEnded'::text) AS "?column?"
            FROM al
           WHERE ((al.j ->> 'act'::text) IS NOT NULL)
         UNION
          SELECT x.target_act_id,
             (c.depth + 1),
             c.ended
            FROM (chain c
              JOIN acts_public x ON ((x.id = c.id)))
           WHERE (((c.depth < 2) OR ((c.depth < 3) AND c.ended)) AND (x.target_act_id IS NOT NULL))
         ), ac AS (
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
           WHERE (a.id IN ( SELECT c.id
                    FROM chain c))
         ), th AS (
          SELECT DISTINCT ((al.j ->> 'thread'::text))::uuid AS id
            FROM al
           WHERE (((al.j ->> 'kind'::text) = 'followed'::text) AND ((al.j ->> 'thread'::text) IS NOT NULL))
         )
  SELECT jsonb_build_object('alerts', COALESCE(( SELECT jsonb_agg(al.j ORDER BY al.o) AS jsonb_agg
            FROM al), '[]'::jsonb), 'seenAt', ( SELECT p.alerts_seen_at
            FROM account_preferences p
          LIMIT 1), 'openedAt', my_account_opened(), 'acts', COALESCE(( SELECT jsonb_agg(to_jsonb(a.*) ORDER BY a.created_at, ((a.id)::text COLLATE "C")) AS jsonb_agg
            FROM ac a), '[]'::jsonb), 'people', COALESCE(( SELECT jsonb_agg(f.face ORDER BY f.name) AS jsonb_agg
            FROM ( SELECT cp.name,
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
                           WHERE (c.id IN ( SELECT a."character"
                                    FROM ac a
                                   WHERE (a.id IN ( SELECT h.id
   FROM chain h
  WHERE (h.depth = 3)))))) cp) f), '[]'::jsonb), 'openings', COALESCE(( SELECT jsonb_agg(to_jsonb(a.*) ORDER BY ((a.thread)::text COLLATE "C")) AS jsonb_agg
            FROM acts_public a
           WHERE ((a.thread IN ( SELECT t.id
                    FROM th t)) AND (a.seq = 1))), '[]'::jsonb), 'reading', COALESCE(( SELECT jsonb_agg(to_jsonb(r.*) ORDER BY ((r.thread)::text COLLATE "C")) AS jsonb_agg
            FROM ( SELECT g.thread,
                     g.furthest_seq
                    FROM reading g
                   WHERE (g.thread IN ( SELECT t.id
                            FROM th t))) r), '[]'::jsonb)) AS jsonb_build_object
  );
end
$function$;

create or replace function public.beat_mod_name(in_board uuid)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public', 'pg_temp'
 set plan_cache_mode = force_generic_plan
 set jit = off
as $function$
#variable_conflict use_column
begin
  return (
  select jsonb_build_object('mod', c.name, 'pronouns', (select p.pronouns from character_profiles p where p.character = c.id), 'board', b.name)
  from boards_now b
  join characters c on c.staff = beat_of(b.id) and c.debuted_at is not null and c.retired_at is null
  where b.id = beat_mod_name.in_board
  );
end
$function$;

create or replace function public.board_page(in_slug text, in_page integer, effect_cards text[])
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
  WITH b AS (
          SELECT x.id,
             x.slug,
             x.name,
             x.description,
             x.is_system,
             x.move_act,
             x.closed
            FROM boards_now x
           WHERE ((x.slug = board_page.in_slug) OR ((x.id)::text = board_page.in_slug))
           ORDER BY (x.slug = board_page.in_slug) DESC
          LIMIT 1
         ), p AS (
          SELECT b_1.id AS board,
             c.total,
             LEAST(GREATEST(COALESCE(board_page.in_page, 1), 1), GREATEST(1, (ceil(((c.total)::numeric / 20.0)))::integer)) AS page
            FROM (b b_1
              CROSS JOIN LATERAL ( SELECT COALESCE(( SELECT n.threads
                            FROM board_counts n
                           WHERE (n.board = b_1.id)), 0) AS total) c)
           WHERE (NOT b_1.closed)
         ), went AS (
          SELECT board_closed_to(b_1.id) AS to_board
            FROM b b_1
           WHERE b_1.closed
         ), listed AS MATERIALIZED (
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
             l.origin_place
            FROM thread_list l
           WHERE (l.board = ( SELECT p_1.board
                    FROM p p_1))
           ORDER BY l.last_at DESC
          OFFSET ( SELECT ((p_1.page - 1) * 20)
                    FROM p p_1)
          LIMIT 20
         ), pins AS MATERIALIZED (
          SELECT x.thread,
             x.play,
             x.ends_at,
             x.act
            FROM (p p_1
              CROSS JOIN LATERAL pinned_threads(p_1.board) x(thread, play, ends_at, act))
           WHERE (p_1.page = 1)
         ), banner AS MATERIALIZED (
          SELECT x.play,
             x.reach,
             x.target,
             x.ends_at,
             x.act
            FROM (p p_1
              CROSS JOIN LATERAL effects_above('{}'::uuid[], NULL::uuid, p_1.board) x(play, reach, target, ends_at, act))
         ), marked AS MATERIALIZED (
          SELECT ((m.act ->> 'id'::text))::uuid AS id,
             (m.act ->> 'character'::text) AS "character",
             (m.act #>> '{payload,card}'::text[]) AS card
            FROM ( SELECT pins.act
                    FROM pins
                 UNION ALL
                  SELECT banner.act
                    FROM banner) m
         ), wanted AS (
          SELECT m.id
            FROM marked m
           WHERE (m.card = ANY (COALESCE(board_page.effect_cards, '{}'::text[])))
         ), threads AS MATERIALIZED (
          SELECT l.id,
             l.first_character,
             l.last_character
            FROM listed l
         UNION
          SELECT ((x.thread ->> 'id'::text))::uuid AS uuid,
             ((x.thread ->> 'first_character'::text))::uuid AS uuid,
             ((x.thread ->> 'last_character'::text))::uuid AS uuid
            FROM pins x
         ), people AS (
          SELECT t.first_character AS id
            FROM threads t
         UNION
          SELECT t.last_character
            FROM threads t
         UNION
          SELECT (m."character")::uuid AS "character"
            FROM marked m
         )
  SELECT jsonb_build_object('board', (to_jsonb(b.*) - 'closed'::text), 'closed', b.closed, 'mergedInto', ( SELECT (w.to_board -> 'mergedInto'::text)
            FROM went w), 'goesTo', ( SELECT (w.to_board -> 'goesTo'::text)
            FROM went w), 'fallback', ( SELECT (w.to_board -> 'fallback'::text)
            FROM went w), 'stubs',
         CASE
             WHEN (p.page = 1) THEN board_stubs(p.board)
             ELSE '[]'::jsonb
         END, 'total', COALESCE(p.total, 0), 'page', COALESCE(p.page, 1), 'threads', ( SELECT COALESCE(jsonb_agg(to_jsonb(l.*)), '[]'::jsonb) AS "coalesce"
            FROM listed l), 'pins', ( SELECT COALESCE(jsonb_agg(to_jsonb(x.*) ORDER BY ((x.act ->> 'created_at'::text))::timestamp with time zone DESC, x.play DESC), '[]'::jsonb) AS "coalesce"
            FROM pins x), 'banner', ( SELECT COALESCE(jsonb_agg(to_jsonb(x.*) ORDER BY ((x.act ->> 'created_at'::text))::timestamp with time zone, x.play), '[]'::jsonb) AS "coalesce"
            FROM banner x), 'states', ( SELECT COALESCE(jsonb_agg(jsonb_build_object('play', s.play, 'state', s.state, 'saved_at', s.saved_at)), '[]'::jsonb) AS "coalesce"
            FROM effect_state s
           WHERE (s.play IN ( SELECT wanted.id
                    FROM wanted))), 'releases', ( SELECT COALESCE(jsonb_agg(jsonb_build_object('play', r.play)), '[]'::jsonb) AS "coalesce"
            FROM effect_releases r
           WHERE (r.play IN ( SELECT wanted.id
                    FROM wanted))), 'tallies', ( SELECT COALESCE(jsonb_agg(jsonb_build_object('act', t.act, 'kind', t.kind, 'count', t.count)), '[]'::jsonb) AS "coalesce"
            FROM reaction_tallies t
           WHERE (t.act IN ( SELECT marked.id
                    FROM marked))), 'mine', ( SELECT COALESCE(jsonb_agg(jsonb_build_object('act', r.act, 'kind', r.kind, 'character', r."character")), '[]'::jsonb) AS "coalesce"
            FROM my_reactions r
           WHERE (r.act IN ( SELECT marked.id
                    FROM marked))), 'reading', ( SELECT COALESCE(jsonb_agg(jsonb_build_object('thread', r.thread, 'furthest_seq', r.furthest_seq)), '[]'::jsonb) AS "coalesce"
            FROM reading r
           WHERE (r.thread IN ( SELECT threads.id
                    FROM threads))), 'views', ( SELECT COALESCE(jsonb_agg(jsonb_build_object('thread', v.thread, 'views', v.views)), '[]'::jsonb) AS "coalesce"
            FROM thread_view_counts v
           WHERE (v.thread IN ( SELECT threads.id
                    FROM threads))), 'characters', ( SELECT COALESCE(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'joined', c.joined, 'staff', c.staff, 'office', c.office, 'profile',
                 CASE
                     WHEN (f."character" IS NULL) THEN NULL::jsonb
                     ELSE (jsonb_build_object('title', f.title, 'signature', f.signature, 'avatar_square', f.avatar_square, 'avatar_portrait', f.avatar_portrait, 'square_frame', f.square_frame, 'portrait_frame', f.portrait_frame, 'pip_style', f.pip_style, 'pronouns', f.pronouns) || profile_cosmetics(f."character"))
                 END)), '[]'::jsonb) AS "coalesce"
            FROM (characters_public c
              LEFT JOIN character_profiles f ON ((f."character" = c.id)))
           WHERE (c.id IN ( SELECT people.id
                    FROM people
                   WHERE (people.id IS NOT NULL)))), 'presence',
         CASE
             WHEN (p.board IS NULL) THEN NULL::jsonb
             ELSE presence_box('board'::text, p.board)
         END, 'unread', my_alerts_unread()) AS jsonb_build_object
    FROM (b
      LEFT JOIN p ON ((p.board = b.id)))
  );
end
$function$;

create or replace function public.boot()
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
  SELECT jsonb_build_object('settings', ( SELECT s.settings
            FROM screen_settings s
          LIMIT 1), 'account', ( SELECT to_jsonb(whoami()) AS to_jsonb), 'preferences', ( SELECT to_jsonb(p.*) AS to_jsonb
            FROM ( SELECT a.theme,
                     a.postbit,
                     a.motion,
                     a.smoke,
                     a.contrast,
                     a.text_size,
                     a.tilt,
                     a.effects,
                     a.game_sound,
                     a.game_volume,
                     a.interface_sound,
                     a.interface_volume,
                     a.mode,
                     a.cards_met,
                     a.alerts_seen_at,
                     a.settlement_seen,
                     a.toasts,
                     a.welcomed_at,
                     a.tips,
                     a.tips_seen
                    FROM account_preferences a
                  LIMIT 1) p), 'characters', COALESCE(( SELECT jsonb_agg(to_jsonb(c.*) ORDER BY c.name) AS jsonb_agg
            FROM my_characters c), '[]'::jsonb), 'faces', COALESCE(( SELECT jsonb_agg(f.face ORDER BY f.name) AS jsonb_agg
            FROM ( SELECT cp.name,
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
                    FROM characters_public cp
                   WHERE (cp.id IN ( SELECT m.id
                            FROM my_characters m))) f), '[]'::jsonb), 'wallet', ( SELECT to_jsonb(w.*) AS to_jsonb
            FROM ( SELECT mw.balance,
                     mw.cap
                    FROM my_wallet mw
                  LIMIT 1) w), 'cards', COALESCE(( SELECT jsonb_agg(to_jsonb(k.*) ORDER BY k.card) AS jsonb_agg
            FROM ( SELECT mc.card,
                     mc.held
                    FROM my_cards mc) k), '[]'::jsonb), 'boards', COALESCE(( SELECT jsonb_agg(jsonb_build_object('id', b.id, 'slug', b.slug, 'name', b.name, 'description', b.description, 'is_system', b.is_system, 'move_act', b.move_act, 'thread_count', COALESCE(bc.threads, 0), 'last_at', l.last_at, 'last_character', l.last_character, 'last_thread', l.id, 'last_title', l.title) ORDER BY b.created_at, b.id) AS jsonb_agg
            FROM ((boards_now b
              LEFT JOIN board_counts bc ON ((bc.board = b.id)))
              LEFT JOIN LATERAL ( SELECT t.id,
                     t.title,
                     t.last_at,
                     t.last_character
                    FROM thread_list t
                   WHERE (t.board = b.id)
                   ORDER BY t.last_at DESC
                  LIMIT 1) l ON (true))), '[]'::jsonb), 'admin', COALESCE(is_admin(), false), 'unread',
         CASE
             WHEN (whoami() IS NULL) THEN 0
             ELSE my_alerts_unread()
         END, 'nextSettlementAt', next_settlement_at(), 'lastSettledAt', ( SELECT s.ends_at
            FROM settlements s
           ORDER BY s.ends_at DESC
          LIMIT 1), 'newestSettlement', ( SELECT s.ends_at
            FROM settlements s
           WHERE (s.id = ( SELECT max(l.settlement) AS max
                    FROM my_ledger l)))) AS jsonb_build_object
  );
end
$function$;

create or replace function public.card_target(target uuid)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public', 'pg_temp'
 set plan_cache_mode = force_generic_plan
 set jit = off
as $function$
#variable_conflict use_column
begin
  return (
  select jsonb_build_object('reach', 'post', 'act', a.id, 'kind', a.kind, 'author', a.character,
    'length', char_length(coalesce(a.current_payload ->> 'body', '')),
    'body', coalesce(a.current_payload ->> 'body', ''),
    'version', post_version(a.id),
    'effects', coalesce((select jsonb_agg(e.effect order by e.at, e.id) from (
        select k.created_at as at, k.id, jsonb_strip_nulls(jsonb_build_object('card', k.payload ->> 'card', 'act', k.id,
          'gimmick', ck.gimmick, 'ends', k.payload ->> 'ends', 'drive', dp.drive,
          'covered', case when ck.surface then (select bit_count(sf.cover) from surfaces sf where sf.play = k.id) end, 'closes', to_jsonb(dp.closes),
          'quadrant', case when ck.skim is not null then k.payload #>> '{config,quadrant}' end)) as effect
        from acts k left join card_kinds ck on ck.key = k.payload ->> 'card'
        -- One grouped read of the post's drive plays: each play's drive, and that drive's close (its latest play plus the card's `lasts`).
        left join (select d.id, d.drive, max(d.created_at) over (partition by d.card, d.drive) + span_interval(dk.drive -> 'lasts') as closes
                   from drive_plays(a.id) d join card_kinds dk on dk.key = d.card) dp on dp.id = k.id
        where k.kind = 'card' and k.target_act_id = a.id and not (k.payload ? 'caught') and not card_ended(k.id) and coalesce(k.payload ->> 'reach', 'post') = 'post'
        union all
        select s.created_at, s.id, jsonb_build_object('card', null, 'act', s.id, 'faceDown', true,
          'ends', to_jsonb(coalesce(least(sp.created_at, tb.created_at, f.ends_at), f.ends_at)))
        from acts s join face_down f on f.play = s.id
        left join acts sp on sp.kind = 'spring' and (sp.payload ->> 'set') = s.id::text
        left join acts tb on tb.kind = 'take_back' and (tb.payload ->> 'set') = s.id::text
        where s.kind = 'set' and s.target_act_id = a.id
      ) e), '[]'))
    -- Where the target is a reply a play in force draws under its parent (post_under): the parent, and no key for any other post.
    || coalesce((select jsonb_build_object('under', u.parent) from post_under u where u.reply = a.id and not card_ended(u.play)), '{}'::jsonb)
  from acts_public a where a.id = target
  );
end
$function$;

create or replace function public.conduct_accepted()
 returns boolean
 language plpgsql
 stable security definer
 set search_path to 'public', 'pg_temp'
 set plan_cache_mode = force_generic_plan
 set jit = off
as $function$
#variable_conflict use_column
begin
  return (
  select not exists (select 1 from settings s where s.key = 'conductVersion')
      or exists (select 1 from conduct_acceptances c
                 where c.account = auth.uid() and c.version = (select (s.value #>> '{}')::integer from settings s where s.key = 'conductVersion'))
  );
end
$function$;

create or replace function public.drive_gifts_page(drive uuid, before_at timestamp with time zone, before_id uuid)
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
  SELECT jsonb_build_object('gifts', COALESCE(jsonb_agg(jsonb_build_object('id', x.id, 'character', x."character", 'name', x.name, 'amount', ((x.payload ->> 'amount'::text))::integer, 'at', x.created_at) ORDER BY x.created_at DESC, x.id DESC) FILTER (WHERE (x.n <= 20)), '[]'::jsonb), 'more', COALESCE(bool_or((x.n > 20)), false)) AS jsonb_build_object
    FROM ( SELECT l.id,
             l."character",
             c.name,
             l.payload,
             l.created_at,
             row_number() OVER (ORDER BY l.created_at DESC, l.id DESC) AS n
            FROM (acts_public l
              LEFT JOIN characters_public c ON ((c.id = l."character")))
           WHERE ((l.kind = 'donation'::text) AND (l.target_act_id = drive_gifts_page.drive) AND (ROW(l.created_at, l.id) < ROW(drive_gifts_page.before_at, drive_gifts_page.before_id)))
           ORDER BY l.created_at DESC, l.id DESC
          LIMIT 21) x
  );
end
$function$;

create or replace function public.finished_seasons()
 returns table(number integer, starts_at timestamp with time zone, ends_at timestamp with time zone, results_at timestamp with time zone, characters integer)
 language plpgsql
 stable
 set search_path to 'public', 'pg_temp'
 set plan_cache_mode = force_generic_plan
 set jit = off
as $function$
#variable_conflict use_column
begin
  return query
  SELECT f.number,
     f.starts_at,
     f.ends_at,
     f.results_at,
     COALESCE(f.results_count, 0) AS "coalesce"
    FROM seasons_finished f
   ORDER BY f.number DESC
  LIMIT 200;
end
$function$;

create or replace function public.index_page()
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
  WITH bs AS MATERIALIZED (
          SELECT b.id,
             b.slug,
             b.name,
             b.description,
             b.is_system,
             b.move_act,
             b.created_at,
             COALESCE(c.threads, 0) AS thread_count,
             l.id AS last_thread,
             l.title AS last_title,
             l.last_at,
             l.last_character
            FROM ((boards_now b
              LEFT JOIN board_counts c ON ((c.board = b.id)))
              LEFT JOIN LATERAL ( SELECT t.id,
                     t.title,
                     t.last_at,
                     t.last_character
                    FROM thread_list t
                   WHERE (t.board = b.id)
                   ORDER BY t.last_at DESC
                  LIMIT 1) l ON (true))
           WHERE (NOT b.closed)
         )
  SELECT jsonb_build_object('boards', ( SELECT COALESCE(jsonb_agg(jsonb_build_object('id', b.id, 'slug', b.slug, 'name', b.name, 'description', b.description, 'is_system', b.is_system, 'move_act', b.move_act, 'thread_count', b.thread_count, 'last_at', b.last_at, 'last_character', b.last_character, 'last_thread', b.last_thread, 'last_title', b.last_title) ORDER BY b.created_at, b.id), '[]'::jsonb) AS "coalesce"
            FROM bs b), 'characters', ( SELECT COALESCE(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'joined', c.joined, 'staff', c.staff, 'office', c.office, 'profile',
                 CASE
                     WHEN (f."character" IS NULL) THEN NULL::jsonb
                     ELSE (jsonb_build_object('title', f.title, 'signature', f.signature, 'avatar_square', f.avatar_square, 'avatar_portrait', f.avatar_portrait, 'square_frame', f.square_frame, 'portrait_frame', f.portrait_frame, 'pip_style', f.pip_style, 'pronouns', f.pronouns) || profile_cosmetics(f."character"))
                 END)), '[]'::jsonb) AS "coalesce"
            FROM (characters_public c
              LEFT JOIN character_profiles f ON ((f."character" = c.id)))
           WHERE (c.id IN ( SELECT b.last_character
                    FROM bs b
                   WHERE (b.last_character IS NOT NULL)))), 'presence', presence_box('index'::text, NULL::uuid), 'unread', my_alerts_unread()) AS jsonb_build_object
  );
end
$function$;

create or replace function public.is_admin()
 returns boolean
 language plpgsql
 stable security definer
 set search_path to 'public', 'pg_temp'
 set plan_cache_mode = force_generic_plan
 set jit = off
as $function$
#variable_conflict use_column
begin
  return (
  select exists (select 1 from admins where account = auth.uid())
  );
end
$function$;

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
             c.repriced
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
             p.bought_at
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
          LIMIT 1)) AS jsonb_build_object
  );
end
$function$;

create or replace function public.move_thread_names(items jsonb)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public', 'pg_temp'
 set plan_cache_mode = force_generic_plan
 set jit = off
as $function$
#variable_conflict use_column
begin
  return (
  select coalesce(jsonb_agg(jsonb_build_object('key', i.k, 'title', t.title, 'left', case when i.act is not null then d.from_board else t.board end)), '[]'::jsonb)
  from (
    select coalesce(x ->> 'act', x ->> 'thread') as k, safe_uuid(x ->> 'thread') as thread, safe_uuid(x ->> 'act') as act
    from jsonb_array_elements(case when jsonb_typeof(items) = 'array' then items else '[]'::jsonb end) with ordinality o(x, n) where n <= 50
  ) i
  join threads t on t.id = i.thread
  left join thread_departures d on d.act = i.act
  );
end
$function$;

create or replace function public.my_account_opened()
 returns timestamp with time zone
 language plpgsql
 stable security definer
 set search_path to 'public', 'pg_temp'
 set plan_cache_mode = force_generic_plan
 set jit = off
as $function$
#variable_conflict use_column
begin
  return (
  select a.created_at from accounts a where a.id = signed_in_account()
  );
end
$function$;

create or replace function public.my_alerts(before timestamp with time zone DEFAULT NULL::timestamp with time zone, most integer DEFAULT 30)
 returns setof alert_row
 language plpgsql
 stable security definer
 set search_path to 'public', 'pg_temp'
 set plan_cache_mode = force_generic_plan
 set jit = off
as $function$
#variable_conflict use_column
begin
  return query
  with me as materialized (select signed_in_account() as id),
  lim as (select coalesce($1, 'infinity'::timestamptz) as before, greatest(1, least(coalesce($2, 30), 100)) as k),
  -- Written: the instant of the k-th newest row before the cursor, so the range below is k rows and their ties.
  w_floor as (
    select coalesce((select a.at from alerts a where a.account = (select id from me) and a.at < (select before from lim)
                     order by a.at desc offset (select k - 1 from lim) limit 1), '-infinity'::timestamptz) as at
  ),
  written as (
    select a.kind, a.sub, a.act, a.character, a.at, ac.thread, c.name, t.title, null::integer as count
    from alerts a
    left join acts ac on ac.id = a.act
    left join characters c on c.id = a.character
    left join threads t on t.id = ac.thread
    where a.account = (select id from me) and a.at < (select before from lim) and a.at >= (select at from w_floor)
  ),
  f as materialized (select * from my_followed_threads v where v.newest_at < (select before from lim)),
  f_floor as (
    select coalesce((select v.newest_at from f v order by v.newest_at desc offset (select k - 1 from lim) limit 1), '-infinity'::timestamptz) as at
  ),
  followed as (
    select 'followed'::text as kind, null::text as sub, null::uuid as act, null::uuid as character, v.newest_at as at, v.thread, null::text as name, v.title, v.new_posts as count
    from f v where v.newest_at >= (select at from f_floor)
  ),
  -- Settlements: the caller's ledger lines from the newest settlement back, grouped as they stream, k settlements.
  -- The ledger is read up to the newest settlement applied before the cursor: the largest id among them, so no settlement that
  -- qualifies is cut whatever order the ids came in (a stand-in for time that assumed they go together broke where a committed
  -- settlement was applied later than a newer id). Without a cursor it is the largest id there is, from the key alone.
  hi as (
    select coalesce(case when (select before from lim) = 'infinity'::timestamptz then (select max(s.id) from settlements s)
                         else (select max(s.id) from settlements s where s.applied_at < (select before from lim)) end, 0) as id
  ),
  st_k as (
    select s.id, s.applied_at, count(distinct l.character)::integer as n
    from ledger l join settlements s on s.id = l.settlement
    where l.account = (select id from me) and l.settlement <= (select id from hi) and s.applied_at < (select before from lim)
    group by s.id, s.applied_at
    order by s.id desc limit (select k from lim)
  ),
  st_floor as (
    select case when (select count(*) from st_k) = (select k from lim) then (select min(applied_at) from st_k) else '-infinity'::timestamptz end as at
  ),
  st_tie as (
    select s.id, s.applied_at, g.n
    from settlements s
    cross join lateral (select count(distinct l.character)::integer as n from ledger l
                        where l.account = (select id from me) and l.settlement = s.id having count(*) > 0) g
    where s.applied_at = (select at from st_floor) and s.id not in (select id from st_k)
  ),
  settled as (
    select 'settlement'::text as kind, x.id::text as sub, null::uuid as act, null::uuid as character, x.applied_at as at, null::uuid as thread, null::text as name, null::text as title, x.n as count
    from (select * from st_k union all select * from st_tie) x
  ),
  merged as (
    select * from written
    union all select * from followed
    union all select * from settled
    union all select * from alerts_news((select before from lim), (select k from lim))
  )
  select m.kind, m.sub, m.act, m.character, m.at, m.thread, m.name, m.title, m.count
  from merged m
  where m.at >= coalesce((select m2.at from merged m2 order by m2.at desc offset (select k - 1 from lim) limit 1), '-infinity'::timestamptz)
  order by m.at desc, m.kind, m.sub nulls first, m.act nulls first, m.thread nulls first;
end
$function$;

create or replace function public.my_alerts_unread()
 returns integer
 language plpgsql
 stable security definer
 set search_path to 'public', 'pg_temp'
 set plan_cache_mode = force_generic_plan
 set jit = off
as $function$
#variable_conflict use_column
begin
  return (
  with me as materialized (select signed_in_account() as id),
  seen as (
    select coalesce((select p.alerts_seen_at from account_preferences p where p.account = (select id from me)),
                    (select a.created_at from accounts a where a.id = (select id from me))) as at
  ),
  parts as (
    select (select count(*) from (select 1 from alerts a where a.account = (select id from me) and a.at > (select at from seen) limit 10) w) as n
    union all
    -- Followed threads, by their own probe that stops at ten and not by the view that reads every one (0059): the threads the caller
    -- started (acts_thread_openers) and chose, less the ones unfollowed, kept where a post by a character they do not own sits past
    -- their place and after the mark. A thread whose last Act is no newer than the mark (threads.last_at, 0030) is skipped from its
    -- own row; the post is looked for from the newest back, so a thread with one is answered by the first row.
    select (select count(*) from (
      select 1 from (
        select o.thread from characters c join acts o on o.character = c.id and o.seq = 1 where c.owner = (select id from me)
        union
        select f.thread from thread_follows f where f.account = (select id from me) and f.follow
      ) fo
      join threads th on th.id = fo.thread
      left join reading r on r.account = (select id from me) and r.thread = th.id
      where th.last_at > (select at from seen)
        and not exists (select 1 from thread_follows u where u.account = (select id from me) and u.thread = th.id and not u.follow)
        and exists (select 1 from acts a join characters pc on pc.id = a.character
                    where a.thread = th.id and a.kind = 'post' and a.seq > coalesce(r.furthest_seq, 0) and a.created_at > (select at from seen)
                      and pc.owner is distinct from (select id from me)
                    order by a.seq desc limit 1)
      limit 10) f)
    union all
    select (select count(*) from (
      select 1 from ledger l join settlements s on s.id = l.settlement
      where l.account = (select id from me)
        and l.settlement >= coalesce((select min(s0.id) from settlements s0 where s0.applied_at > (select at from seen)), 9223372036854775807)
        and s.applied_at > (select at from seen)
      group by l.settlement order by l.settlement desc limit 10) x)
    union all
    select alerts_news_unread((select at from seen))
  )
  select least(10, sum(n))::integer from parts
  );
end
$function$;

create or replace function public.my_apologies(in_character uuid)
 returns table(move_act uuid, state text, created_at timestamp with time zone, next_at timestamp with time zone)
 language plpgsql
 stable security definer
 set search_path to 'public', 'pg_temp'
 set plan_cache_mode = force_generic_plan
 set jit = off
as $function$
#variable_conflict use_column
begin
  return query
  select x.move_act, x.state, x.created_at,
         case when x.state = 'returned' then null else x.created_at + make_interval(hours => apology_setting('apologyEveryHours')) end
  from apologies x
  where x.character = in_character
    and exists (select 1 from characters c where c.id = in_character and c.owner = auth.uid())
  order by x.created_at desc, x.id desc;
end
$function$;

create or replace function public.my_bar()
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public', 'pg_temp'
 set plan_cache_mode = force_generic_plan
 set jit = off
as $function$
#variable_conflict use_column
begin
  return (
  select account_bar(auth.uid()) where auth.uid() is not null
  );
end
$function$;

create or replace function public.my_characters_page()
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
  SELECT jsonb_build_object('characters', COALESCE(( SELECT jsonb_agg((to_jsonb(c.*) || jsonb_build_object('face', ( SELECT (to_jsonb(cp.*) || jsonb_build_object('profile', ( SELECT (to_jsonb(p.*) || profile_cosmetics(p."character"))
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
                                   WHERE (r."character" = cp.id)) p)))
                    FROM characters_public cp
                   WHERE (cp.id = c.id)), 'counts', ( SELECT to_jsonb(n.*) AS to_jsonb
                    FROM ( SELECT k."character",
                             k.posts,
                             k.spins,
                             k.cards
                            FROM character_post_counts k
                           WHERE (k."character" = c.id)) n), 'standing', ( SELECT s.standing
                    FROM current_standings s
                   WHERE (s."character" = c.id)), 'reveals', COALESCE(( SELECT jsonb_agg(to_jsonb(r.*) ORDER BY r.at, ((r.act)::text COLLATE "C")) AS jsonb_agg
                    FROM ( SELECT v.act,
                             v."character",
                             v.class,
                             v.at,
                             v.via,
                             v.thread
                            FROM class_reveals v
                           WHERE (v."character" = c.id)) r), '[]'::jsonb), 'turns', COALESCE(( SELECT jsonb_agg(to_jsonb(t.*) ORDER BY t.at, ((t.act)::text COLLATE "C")) AS jsonb_agg
                    FROM ( SELECT u.act,
                             u."character",
                             u.at,
                             u.was
                            FROM turns_announced u
                           WHERE (u."character" = c.id)) t), '[]'::jsonb))) ORDER BY c.name) AS jsonb_agg
            FROM my_characters c), '[]'::jsonb), 'nextSettlementAt', next_settlement_at()) AS jsonb_build_object
  );
end
$function$;

create or replace function public.my_conduct_log(most integer DEFAULT 100)
 returns table(decision bigint, outcome text, version_act uuid, post uuid, thread uuid, at timestamp with time zone)
 language plpgsql
 stable security definer
 set search_path to 'public', 'pg_temp'
 set plan_cache_mode = force_generic_plan
 set jit = off
as $function$
#variable_conflict use_column
begin
  return query
  select d.id, d.outcome, d.version_act, d.post, a.thread, d.at
  from conduct_decisions d
  join acts a on a.id = d.version_act
  join characters c on c.id = a.character
  where d.outcome in ('hide', 'hideUntilEdited', 'unhide', 'approve') and c.owner = auth.uid()
  order by d.id desc
  limit greatest(least(most, 500), 0);
end
$function$;

create or replace function public.my_open_reports()
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public', 'pg_temp'
 set plan_cache_mode = force_generic_plan
 set jit = off
as $function$
#variable_conflict use_column
begin
  return (
  select jsonb_build_object(
    'open', (select count(*) from conduct_reports r where r.reporter = auth.uid() and not exists (select 1 from conduct_decisions d where d.report = r.id)),
    'most', (setting('conduct') ->> 'openReportsMost')::integer)
  );
end
$function$;

create or replace function public.my_settlement_moved(settlement bigint)
 returns table(count integer, applied_at timestamp with time zone)
 language plpgsql
 stable security definer
 set search_path to 'public', 'pg_temp'
 set plan_cache_mode = force_generic_plan
 set jit = off
as $function$
#variable_conflict use_column
begin
  return query
  select count(distinct l.character)::integer, s.applied_at
  from ledger l join settlements s on s.id = l.settlement
  where l.account = signed_in_account() and l.settlement = $1
  group by s.applied_at;
end
$function$;

create or replace function public.my_wardrobe()
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public', 'pg_temp'
 set plan_cache_mode = force_generic_plan
 set jit = off
as $function$
#variable_conflict use_column
begin
  return (
  select coalesce(jsonb_agg(jsonb_build_object('gear', h.gear, 'rarity', k.rarity, 'held', h.held,
      'worn_by', coalesce((select jsonb_agg(w.character order by w.character) from characters c join gear_worn w on w.character = c.id
                           where c.owner = signed_in_account() and w.gear = h.gear), '[]'::jsonb)) order by h.gear), '[]'::jsonb)
  from (select l.gear, count(*)::integer as held from gear_ledger l where l.account = signed_in_account() group by l.gear) h
  join gear_kinds k on k.key = h.gear
  );
end
$function$;

create or replace function public.pinned_threads(board uuid)
 returns table(thread jsonb, play uuid, ends_at timestamp with time zone, act jsonb)
 language plpgsql
 stable security definer
 set search_path to 'public', 'pg_temp'
 set plan_cache_mode = force_generic_plan
 set jit = off
as $function$
#variable_conflict use_column
begin
  return query
  select to_jsonb(t), r.play, r.ends_at, to_jsonb(a)
  from play_reach r join thread_list t on t.id = r.thread join acts_public a on a.id = r.play
  where r.pins_board = pinned_threads.board and r.ends_at > now() and not card_ended(r.play)
  order by a.created_at desc, a.id desc;
end
$function$;

create or replace function public.profile_page(in_character uuid)
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
  WITH c AS (
          SELECT characters_public.id,
             characters_public.name,
             characters_public.joined,
             characters_public.staff,
             characters_public.office,
             characters_public.warn_points,
             characters_public.banned_until,
             characters_public."group"
            FROM characters_public
           WHERE (characters_public.id = profile_page.in_character)
         ), acts5 AS (
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
           WHERE ((a."character" = profile_page.in_character) AND (a.kind = ANY (ARRAY['post'::text, 'spin'::text, 'card'::text])))
           ORDER BY a.created_at DESC
          LIMIT 5
         ), rv AS (
          SELECT r.act,
             r."character",
             r.class,
             r.at,
             r.via,
             r.thread
            FROM class_reveals r
           WHERE (r."character" = profile_page.in_character)
         ), tn AS (
          SELECT t.act,
             t."character",
             t.at,
             t.was
            FROM turns_announced t
           WHERE (t."character" = profile_page.in_character)
         )
  SELECT
         CASE
             WHEN (NOT (EXISTS ( SELECT 1
                FROM c))) THEN NULL::jsonb
             ELSE jsonb_build_object('character', ( SELECT to_jsonb(c.*) AS to_jsonb
                FROM c), 'profile', ( SELECT (to_jsonb(p.*) || profile_cosmetics(p."character"))
                FROM ( SELECT character_profiles."character",
                         character_profiles.title,
                         character_profiles.signature,
                         character_profiles.avatar_square,
                         character_profiles.avatar_portrait,
                         character_profiles.square_frame,
                         character_profiles.portrait_frame,
                         character_profiles.pip_style,
                         character_profiles.pronouns
                        FROM character_profiles
                       WHERE (character_profiles."character" = profile_page.in_character)) p), 'counts', ( SELECT to_jsonb(n.*) AS to_jsonb
                FROM ( SELECT character_post_counts."character",
                         character_post_counts.posts,
                         character_post_counts.spins,
                         character_post_counts.cards
                        FROM character_post_counts
                       WHERE (character_post_counts."character" = profile_page.in_character)) n), 'standing', standing_place(in_character), 'settled_at', ( SELECT s.ends_at
                FROM settlements s
               ORDER BY s.ends_at DESC
              LIMIT 1), 'season', ( SELECT to_jsonb(s.*) AS to_jsonb
                FROM current_season s
              LIMIT 1), 'reveals', COALESCE(( SELECT jsonb_agg(to_jsonb(r.*) ORDER BY r.at, ((r.act)::text COLLATE "C")) AS jsonb_agg
                FROM rv r), '[]'::jsonb), 'turns', COALESCE(( SELECT jsonb_agg(to_jsonb(t.*) ORDER BY t.at, ((t.act)::text COLLATE "C")) AS jsonb_agg
                FROM tn t), '[]'::jsonb), 'acts', COALESCE(( SELECT jsonb_agg(to_jsonb(a.*) ORDER BY a.created_at DESC) AS jsonb_agg
                FROM acts5 a), '[]'::jsonb), 'targets', COALESCE(( SELECT jsonb_agg(to_jsonb(x.*)) AS jsonb_agg
                FROM acts_public x
               WHERE (x.id IN ( SELECT a.target_act_id
                        FROM acts5 a
                       WHERE ((a.kind = 'card'::text) AND (a.target_act_id IS NOT NULL))
                     UNION
                      SELECT t.act
                        FROM tn t))), '[]'::jsonb), 'seasons', COALESCE(( SELECT jsonb_agg(to_jsonb(a.*) ORDER BY a.at DESC, a.season DESC) AS jsonb_agg
                FROM ( SELECT f.number AS season,
                         r.place,
                         r.standing,
                         f.results_at AS at
                        FROM (season_results r
                          JOIN seasons_finished f ON ((f.id = r.season)))
                       WHERE (r."character" = profile_page.in_character)
                       ORDER BY f.results_at DESC, f.number DESC
                      LIMIT 50) a), '[]'::jsonb), 'unread', my_alerts_unread())
         END AS jsonb_build_object
  );
end
$function$;

create or replace function public.queue_page()
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
  SELECT
         CASE
             WHEN COALESCE(is_admin(), false) THEN jsonb_build_object('queue', admin_queue(), 'boardNames', COALESCE(( SELECT jsonb_agg(jsonb_build_object('id', n.id, 'slug', n.slug, 'name', n.name, 'was', COALESCE(b.name, n.name)) ORDER BY n.created_at, n.id) AS jsonb_agg
                FROM (boards_now n
                  LEFT JOIN boards b ON ((b.id = n.id)))), '[]'::jsonb), 'bosses', boss_roster_names(), 'contact', admin_contact())
             ELSE NULL::jsonb
         END AS "case"
  );
end
$function$;

create or replace function public.record_page(in_character uuid, in_kind text, in_page integer)
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
  WITH c AS (
          SELECT characters_public.id,
             characters_public.name,
             characters_public.joined,
             characters_public.staff,
             characters_public.office,
             characters_public.warn_points,
             characters_public.banned_until,
             characters_public."group"
            FROM characters_public
           WHERE (characters_public.id = record_page.in_character)
         ), k AS (
          SELECT
                 CASE
                     WHEN (in_kind = ANY (ARRAY['all'::text, 'post'::text, 'spin'::text, 'card'::text, 'class'::text, 'seasons'::text])) THEN in_kind
                     ELSE 'all'::text
                 END AS kind,
             LEAST(GREATEST(COALESCE(in_page, 1), 1), 10000) AS page
         ), rv AS (
          SELECT r.act,
             r."character",
             r.class,
             r.at,
             r.via,
             r.thread
            FROM class_reveals r,
             k
           WHERE ((r."character" = record_page.in_character) AND (k.kind = ANY (ARRAY['all'::text, 'class'::text])))
         ), tn AS (
          SELECT t.act,
             t."character",
             t.at,
             t.was
            FROM turns_announced t,
             k
           WHERE ((t."character" = record_page.in_character) AND (k.kind = ANY (ARRAY['all'::text, 'class'::text])))
         ), seasons_read AS (
          SELECT f.number AS season,
             r.place,
             r.standing,
             f.results_at AS at
            FROM (season_results r
              JOIN seasons_finished f ON ((f.id = r.season))),
             k
           WHERE ((k.kind = ANY (ARRAY['all'::text, 'seasons'::text])) AND (r."character" = record_page.in_character))
           ORDER BY f.results_at DESC, f.number DESC
          LIMIT 50
         ), w AS (
          SELECT
                 CASE k.kind
                     WHEN 'all'::text THEN ARRAY['post'::text, 'spin'::text, 'card'::text]
                     WHEN 'post'::text THEN ARRAY['post'::text]
                     WHEN 'spin'::text THEN ARRAY['spin'::text]
                     WHEN 'card'::text THEN ARRAY['card'::text]
                     ELSE ARRAY[]::text[]
                 END AS kinds,
                 CASE
                     WHEN (k.kind = 'all'::text) THEN GREATEST((0)::bigint, (((k.page - 1) * 20) - ((( SELECT count(*) AS count
                        FROM rv) + ( SELECT count(*) AS count
                        FROM tn)) + ( SELECT count(*) AS count
                        FROM seasons_read))))
                     ELSE (((k.page - 1) * 20))::bigint
                 END AS from_row,
                 CASE
                     WHEN (k.kind = 'all'::text) THEN (((k.page - 1) * 20) + 20)
                     ELSE 20
                 END AS base
            FROM k
         ), acts_read AS (
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
           WHERE ((a."character" = record_page.in_character) AND (a.kind = ANY (( SELECT w.kinds
                    FROM w)::text[])))
           ORDER BY a.created_at DESC
          OFFSET ( SELECT w.from_row
                    FROM w)
          LIMIT ( SELECT
                         CASE
                             WHEN (k.kind = 'all'::text) THEN (w.base - w.from_row)
                             ELSE (20)::bigint
                         END AS "case"
                    FROM w,
                     k)
         )
  SELECT
         CASE
             WHEN (NOT (EXISTS ( SELECT 1
                FROM c))) THEN NULL::jsonb
             ELSE jsonb_build_object('kind', ( SELECT k.kind
                FROM k), 'page', ( SELECT k.page
                FROM k), 'character', ( SELECT to_jsonb(c.*) AS to_jsonb
                FROM c), 'profile', ( SELECT (to_jsonb(p.*) || profile_cosmetics(p."character"))
                FROM ( SELECT character_profiles."character",
                         character_profiles.title,
                         character_profiles.signature,
                         character_profiles.avatar_square,
                         character_profiles.avatar_portrait,
                         character_profiles.square_frame,
                         character_profiles.portrait_frame,
                         character_profiles.pip_style,
                         character_profiles.pronouns
                        FROM character_profiles
                       WHERE (character_profiles."character" = record_page.in_character)) p), 'counts', ( SELECT to_jsonb(n.*) AS to_jsonb
                FROM ( SELECT character_post_counts."character",
                         character_post_counts.posts,
                         character_post_counts.spins,
                         character_post_counts.cards
                        FROM character_post_counts
                       WHERE ((character_post_counts."character" = record_page.in_character) AND (( SELECT k.kind
                                FROM k) = ANY (ARRAY['all'::text, 'post'::text, 'spin'::text, 'card'::text])))) n), 'reveals', COALESCE(( SELECT jsonb_agg(to_jsonb(r.*) ORDER BY r.at, ((r.act)::text COLLATE "C")) AS jsonb_agg
                FROM rv r), '[]'::jsonb), 'turns', COALESCE(( SELECT jsonb_agg(to_jsonb(t.*) ORDER BY t.at, ((t.act)::text COLLATE "C")) AS jsonb_agg
                FROM tn t), '[]'::jsonb), 'seasons', COALESCE(( SELECT jsonb_agg(to_jsonb(a.*) ORDER BY a.at DESC, a.season DESC) AS jsonb_agg
                FROM seasons_read a), '[]'::jsonb), 'acts', COALESCE(( SELECT jsonb_agg(to_jsonb(a.*) ORDER BY a.created_at DESC) AS jsonb_agg
                FROM acts_read a), '[]'::jsonb), 'targets', COALESCE(( SELECT jsonb_agg(to_jsonb(x.*)) AS jsonb_agg
                FROM acts_public x
               WHERE (x.id IN ( SELECT a.target_act_id
                        FROM acts_read a
                       WHERE ((a.kind = 'card'::text) AND (a.target_act_id IS NOT NULL))
                     UNION
                      SELECT t.act
                        FROM tn t))), '[]'::jsonb), 'unread', my_alerts_unread())
         END AS jsonb_build_object
  );
end
$function$;

create or replace function public.result_place(in_season integer, in_character uuid)
 returns integer
 language plpgsql
 stable
 set search_path to 'public', 'pg_temp'
 set plan_cache_mode = force_generic_plan
 set jit = off
as $function$
#variable_conflict use_column
begin
  return (
  SELECT ((( SELECT count(*) AS count
            FROM season_results r
           WHERE ((r.season = f.id) AND (r.standing > x.standing))) + ( SELECT count(*) AS count
            FROM season_results r
           WHERE ((r.season = f.id) AND (r.standing = x.standing) AND (ROW(r.name, r."character") < ROW(x.name, x."character"))))))::integer AS int4
    FROM (seasons_finished f
      JOIN season_results x ON (((x.season = f.id) AND (x."character" = result_place.in_character))))
   WHERE (f.number = result_place.in_season)
  );
end
$function$;

create or replace function public.results_page(in_season integer, page integer)
 returns table("character" uuid, name text, place integer, standing integer, shown jsonb)
 language plpgsql
 stable
 set search_path to 'public', 'pg_temp'
 set plan_cache_mode = force_generic_plan
 set jit = off
as $function$
#variable_conflict use_column
begin
  return query
  SELECT r."character",
     r.name,
     r.place,
     r.standing,
     r.shown
    FROM season_results r
   WHERE (r.season = ( SELECT f.id
            FROM seasons_finished f
           WHERE (f.number = results_page.in_season)))
   ORDER BY r.standing DESC, r.name, r."character"
  OFFSET ((LEAST(GREATEST(COALESCE(results_page.page, 1), 1), 10000) - 1) * 50)
  LIMIT 50;
end
$function$;

create or replace function public.search_posts(q text, author uuid, board uuid, from_at timestamp with time zone, to_at timestamp with time zone, titles_only boolean, sort text, after jsonb, per_page integer)
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
             WHEN (char_length(COALESCE(q, ''::text)) > 200) THEN screen_refusal('a search is at most 200 characters'::text)
             WHEN ((sort IS NOT NULL) AND (sort <> ALL (ARRAY['relevance'::text, 'newest'::text, 'oldest'::text]))) THEN screen_refusal('sort is relevance, newest or oldest'::text)
             WHEN ((COALESCE(per_page, 20) < 1) OR (COALESCE(per_page, 20) > 50)) THEN screen_refusal('a page holds 1 to 50 results'::text)
             WHEN (from_at >= to_at) THEN screen_refusal('the range ends before it begins'::text)
             WHEN ((after IS NOT NULL) AND (NOT search_cursor_ok(after, ((COALESCE(sort, 'relevance'::text) = 'relevance'::text) AND (btrim(COALESCE(q, ''::text)) <> ''::text))))) THEN screen_refusal('that is not a cursor this search gave'::text)
             ELSE NULL::integer
         END AS "case";
  return (
  WITH k AS MATERIALIZED (
          SELECT (btrim(COALESCE(q, ''::text)) <> ''::text) AS has_q
         ), cfg AS MATERIALIZED (
          SELECT COALESCE(search_posts.per_page, 20) AS pp,
             COALESCE(( SELECT ((x.settings ->> 'searchRankPool'::text))::integer AS int4
                    FROM screen_settings x
                  LIMIT 1), 5000) AS pool,
             COALESCE(( SELECT ((x.settings ->> 'postsPerPage'::text))::integer AS int4
                    FROM screen_settings x
                  LIMIT 1), 20) AS thread_pp,
                 CASE
                     WHEN (COALESCE(search_posts.sort, 'relevance'::text) = 'relevance'::text) THEN
                     CASE
                         WHEN k.has_q THEN 'relevance'::text
                         ELSE 'newest'::text
                     END
                     ELSE search_posts.sort
                 END AS s
            FROM k
         ), tsq AS MATERIALIZED (
          SELECT
                 CASE
                     WHEN ( SELECT k.has_q
                        FROM k) THEN websearch_to_tsquery(search_lang(), q)
                     ELSE NULL::tsquery
                 END AS t
         ), au AS MATERIALIZED (
          SELECT
                 CASE
                     WHEN (author IS NULL) THEN NULL::uuid
                     WHEN (EXISTS ( SELECT 1
                        FROM characters_public c
                       WHERE (c.id = search_posts.author))) THEN author
                     ELSE '00000000-0000-0000-0000-000000000000'::uuid
                 END AS id
         ), c AS MATERIALIZED (
          SELECT ((after ->> 'rank'::text))::double precision AS rank,
             ((after ->> 'at'::text))::timestamp with time zone AS at,
             ((after ->> 'act'::text))::uuid AS act
           WHERE (after IS NOT NULL)
         ), m AS MATERIALIZED (
          SELECT search_matches.act,
             search_matches.thread,
             search_matches.board,
             search_matches.title,
             search_matches."character",
             search_matches.created_at,
             search_matches.words
            FROM search_matches(search_posts.q, ( SELECT au.id
                    FROM au), search_posts.board, search_posts.from_at, search_posts.to_at, COALESCE(search_posts.titles_only, false), ( SELECT (cfg.s <> 'oldest'::text)
                    FROM cfg),
                 CASE
                     WHEN (( SELECT cfg.s
                        FROM cfg) <> 'relevance'::text) THEN ( SELECT c.at
                        FROM c)
                     ELSE NULL::timestamp with time zone
                 END,
                 CASE
                     WHEN (( SELECT cfg.s
                        FROM cfg) <> 'relevance'::text) THEN ( SELECT c.act
                        FROM c)
                     ELSE NULL::uuid
                 END,
                 CASE
                     WHEN (( SELECT cfg.s
                        FROM cfg) = 'relevance'::text) THEN (( SELECT cfg.pool
                        FROM cfg) + 1)
                     ELSE (( SELECT cfg.pp
                        FROM cfg) + 1)
                 END) search_matches(act, thread, board, title, "character", created_at, words)
         ), cnt AS MATERIALIZED (
          SELECT count(*) AS n
            FROM search_matches(search_posts.q, ( SELECT au.id
                    FROM au), search_posts.board, search_posts.from_at, search_posts.to_at, COALESCE(search_posts.titles_only, false), true, NULL::timestamp with time zone, NULL::uuid, 1001) search_matches(act, thread, board, title, "character", created_at, words)
         ), ranked AS MATERIALIZED (
          SELECT x.act,
             x.thread,
             x.board,
             x.title,
             x."character",
             x.created_at,
             x.words,
             x.rn,
                 CASE
                     WHEN (( SELECT cfg.s
                        FROM cfg) = 'relevance'::text) THEN (ts_rank_cd(x.words, ( SELECT tsq.t
                        FROM tsq), 1))::double precision
                     ELSE (0)::double precision
                 END AS rank
            FROM ( SELECT m.act,
                     m.thread,
                     m.board,
                     m.title,
                     m."character",
                     m.created_at,
                     m.words,
                     row_number() OVER (ORDER BY m.created_at DESC, m.act DESC) AS rn
                    FROM m) x
           WHERE ((( SELECT cfg.s
                    FROM cfg) <> 'relevance'::text) OR (x.rn <= ( SELECT cfg.pool
                    FROM cfg)))
         ), page AS MATERIALIZED (
          SELECT r.act,
             r.thread,
             r.board,
             r.title,
             r."character",
             r.created_at,
             r.words,
             r.rn,
             r.rank,
             row_number() OVER (ORDER BY r.rank DESC,
                 CASE
                     WHEN (cfg.s = 'oldest'::text) THEN r.created_at
                     ELSE NULL::timestamp with time zone
                 END,
                 CASE
                     WHEN (cfg.s <> 'oldest'::text) THEN r.created_at
                     ELSE NULL::timestamp with time zone
                 END DESC,
                 CASE
                     WHEN (cfg.s = 'oldest'::text) THEN r.act
                     ELSE NULL::uuid
                 END,
                 CASE
                     WHEN (cfg.s <> 'oldest'::text) THEN r.act
                     ELSE NULL::uuid
                 END DESC) AS n
            FROM ranked r,
             cfg
           WHERE ((cfg.s <> 'relevance'::text) OR (NOT (EXISTS ( SELECT 1
                    FROM c))) OR (ROW(r.rank, r.created_at, r.act) < ROW(( SELECT c.rank
                    FROM c), ( SELECT c.at
                    FROM c), ( SELECT c.act
                    FROM c))))
           ORDER BY (row_number() OVER (ORDER BY r.rank DESC,
                 CASE
                     WHEN (cfg.s = 'oldest'::text) THEN r.created_at
                     ELSE NULL::timestamp with time zone
                 END,
                 CASE
                     WHEN (cfg.s <> 'oldest'::text) THEN r.created_at
                     ELSE NULL::timestamp with time zone
                 END DESC,
                 CASE
                     WHEN (cfg.s = 'oldest'::text) THEN r.act
                     ELSE NULL::uuid
                 END,
                 CASE
                     WHEN (cfg.s <> 'oldest'::text) THEN r.act
                     ELSE NULL::uuid
                 END DESC))
          LIMIT (( SELECT cfg_1.pp
                    FROM cfg cfg_1) + 1)
         ), shown AS MATERIALIZED (
          SELECT p.act,
             p.thread,
             p.board,
             p.title,
             p."character",
             p.created_at,
             p.words,
             p.rn,
             p.rank,
             p.n
            FROM page p
           WHERE (p.n <= ( SELECT cfg.pp
                    FROM cfg))
         ), people AS MATERIALIZED (
          SELECT cp.id,
             cp.name
            FROM characters_public cp
           WHERE (cp.id IN ( SELECT s."character"
                    FROM shown s))
         ), places AS MATERIALIZED (
          SELECT b.id,
             b.slug,
             b.name
            FROM boards_now b
           WHERE (b.id IN ( SELECT s.board
                    FROM shown s))
         )
  SELECT jsonb_build_object('count', ( SELECT cnt.n
            FROM cnt), 'more', (( SELECT cnt.n
            FROM cnt) > 1000), 'pooled', ((( SELECT cfg.s
            FROM cfg) = 'relevance'::text) AND (( SELECT count(*) AS count
            FROM m) > ( SELECT cfg.pool
            FROM cfg))), 'results', COALESCE(( SELECT jsonb_agg(jsonb_build_object('act', s.act, 'thread', s.thread, 'title', s.title, 'board', s.board, 'board_slug', pl.slug, 'board_name', pl.name, 'seq', a.seq, 'page', (GREATEST((1)::numeric, ceil(((a.seq)::numeric / (( SELECT cfg.thread_pp
                    FROM cfg))::numeric))))::integer, 'character', s."character", 'name', pe.name, 'created_at', s.created_at, 'snippet',
                 CASE
                     WHEN (( SELECT tsq.t
                        FROM tsq) IS NULL) THEN "left"(regexp_replace(bbcode_plain((a.current_payload ->> 'body'::text)), '\s+'::text, ' '::text, 'g'::text), 200)
                     ELSE ts_headline(search_lang(), bbcode_plain((a.current_payload ->> 'body'::text)), ( SELECT tsq.t
                        FROM tsq), 'StartSel=<<,StopSel=>>,MaxFragments=1,MaxWords=30,MinWords=12'::text)
                 END, 'cards', search_post_cards(s.act)) ORDER BY s.n) AS jsonb_agg
            FROM (((shown s
              JOIN acts_public a ON ((a.id = s.act)))
              LEFT JOIN people pe ON ((pe.id = s."character")))
              LEFT JOIN places pl ON ((pl.id = s.board)))), '[]'::jsonb), 'next', ( SELECT jsonb_build_object('rank', p.rank, 'at', p.created_at, 'act', p.act) AS jsonb_build_object
            FROM page p
           WHERE ((p.n = ( SELECT cfg.pp
                    FROM cfg)) AND (EXISTS ( SELECT 1
                    FROM page x
                   WHERE (x.n = (( SELECT cfg.pp
                            FROM cfg) + 1))))))) AS jsonb_build_object
  );
end
$function$;

-- Force pg_trgm shared library to load in this session so its GUCs are registered as USERSET
SELECT extensions.word_similarity('a', 'b');

create or replace function public.search_suggest(prefix text, kinds text[], board uuid, exclude_system boolean, most integer)
 returns jsonb
 language plpgsql
 stable
 set search_path to 'public', 'pg_temp'
 set "pg_trgm.word_similarity_threshold" to '0.3'
 set plan_cache_mode = force_generic_plan
 set jit = off
as $function$
#variable_conflict use_column
begin
  perform
         CASE
             WHEN ((kinds IS NOT NULL) AND ((cardinality(kinds) = 0) OR (NOT COALESCE((kinds <@ ARRAY['threads'::text, 'characters'::text, 'boards'::text]), false)))) THEN screen_refusal('kinds are threads, characters and boards'::text)
             WHEN ((COALESCE(most, 5) < 1) OR (COALESCE(most, 5) > 10)) THEN screen_refusal('a list holds 1 to 10 suggestions'::text)
             WHEN (char_length(btrim(COALESCE(prefix, ''::text))) > 100) THEN screen_refusal('a prefix is at most 100 characters'::text)
             WHEN (char_length(btrim(COALESCE(prefix, ''::text))) = 1) THEN screen_refusal('a prefix is at least 2 characters'::text)
             WHEN ((char_length(btrim(COALESCE(prefix, ''::text))) = 0) AND (kinds IS DISTINCT FROM ARRAY['threads'::text])) THEN screen_refusal('only the threads list takes an empty prefix'::text)
             ELSE NULL::integer
         END AS "case";
  return (
  WITH p AS MATERIALIZED (
          SELECT fold_text(btrim(COALESCE(prefix, ''::text))) AS fp,
             (replace(replace(replace(fold_text(btrim(COALESCE(prefix, ''::text))), '\'::text, '\\'::text), '%'::text, '\%'::text), '_'::text, '\_'::text) || '%'::text) AS pat,
             COALESCE(most, 5) AS n,
             COALESCE(kinds, ARRAY['threads'::text, 'characters'::text, 'boards'::text]) AS k
         ), found AS MATERIALIZED (
          SELECT t.id,
             t.title,
             t.board
            FROM p,
             LATERAL search_suggest_threads(search_suggest.prefix, search_suggest.board, search_suggest.exclude_system, p.n) t(id, title, board)
           WHERE (p.k @> ARRAY['threads'::text])
         ), board_names AS MATERIALIZED (
          SELECT b.id,
             b.name
            FROM boards_now b
           WHERE (b.id IN ( SELECT f.board
                    FROM found f))
         )
  SELECT jsonb_build_object('threads',
         CASE
             WHEN ( SELECT (p.k @> ARRAY['threads'::text])
                FROM p) THEN COALESCE(( SELECT jsonb_agg(jsonb_build_object('id', t.id, 'title', t.title, 'board', t.board, 'board_name', ( SELECT bn.name
                        FROM board_names bn
                       WHERE (bn.id = t.board)))) AS jsonb_agg
                FROM found t), '[]'::jsonb)
             ELSE '[]'::jsonb
         END, 'characters',
         CASE
             WHEN ( SELECT (p.k @> ARRAY['characters'::text])
                FROM p) THEN COALESCE(( SELECT jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name)) AS jsonb_agg
                FROM suggest_characters(search_suggest.prefix, ( SELECT p.n
                        FROM p)) c(id, name)), '[]'::jsonb)
             ELSE '[]'::jsonb
         END, 'boards',
         CASE
             WHEN ( SELECT (p.k @> ARRAY['boards'::text])
                FROM p) THEN COALESCE(( SELECT jsonb_agg(jsonb_build_object('id', x.id, 'slug', x.slug, 'name', x.name) ORDER BY x.rank DESC, x.created_at DESC, x.id) AS jsonb_agg
                FROM ( SELECT b.id,
                         b.slug,
                         b.name,
                         b.created_at,
                         extensions.word_similarity(( SELECT p.fp
                                FROM p), fold_text(b.name)) AS rank
                        FROM boards_now b
                       WHERE ((( SELECT p.fp
                                FROM p) <> ''::text) AND ((NOT COALESCE(search_suggest.exclude_system, false)) OR (NOT b.is_system)) AND ((fold_text(b.name) ~~ ( SELECT p.pat
                                FROM p)) OR (( SELECT p.fp
                                FROM p) OPERATOR(extensions.<%) fold_text(b.name))))
                       ORDER BY (extensions.word_similarity(( SELECT p.fp
                                FROM p), fold_text(b.name))) DESC, b.created_at DESC, b.id
                      LIMIT ( SELECT p.n
                                FROM p)) x), '[]'::jsonb)
             ELSE '[]'::jsonb
         END) AS jsonb_build_object
  );
end
$function$;

create or replace function public.search_threads(q text, author uuid, board uuid, from_at timestamp with time zone, to_at timestamp with time zone, titles_only boolean, sort text, after jsonb, per_page integer)
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
             WHEN (char_length(COALESCE(q, ''::text)) > 200) THEN screen_refusal('a search is at most 200 characters'::text)
             WHEN ((sort IS NOT NULL) AND (sort <> ALL (ARRAY['relevance'::text, 'newest'::text, 'oldest'::text]))) THEN screen_refusal('sort is relevance, newest or oldest'::text)
             WHEN ((COALESCE(per_page, 20) < 1) OR (COALESCE(per_page, 20) > 50)) THEN screen_refusal('a page holds 1 to 50 results'::text)
             WHEN (from_at >= to_at) THEN screen_refusal('the range ends before it begins'::text)
             WHEN ((after IS NOT NULL) AND (NOT search_cursor_ok(after, ((COALESCE(sort, 'relevance'::text) = 'relevance'::text) AND (btrim(COALESCE(q, ''::text)) <> ''::text))))) THEN screen_refusal('that is not a cursor this search gave'::text)
             ELSE NULL::integer
         END AS "case";
  return (
  WITH k AS MATERIALIZED (
          SELECT (btrim(COALESCE(q, ''::text)) <> ''::text) AS has_q
         ), cfg AS MATERIALIZED (
          SELECT COALESCE(search_threads.per_page, 20) AS pp,
             COALESCE(( SELECT ((x.settings ->> 'searchRankPool'::text))::integer AS int4
                    FROM screen_settings x
                  LIMIT 1), 5000) AS pool,
             COALESCE(( SELECT ((x.settings ->> 'postsPerPage'::text))::integer AS int4
                    FROM screen_settings x
                  LIMIT 1), 20) AS thread_pp,
                 CASE
                     WHEN (COALESCE(search_threads.sort, 'relevance'::text) = 'relevance'::text) THEN
                     CASE
                         WHEN k.has_q THEN 'relevance'::text
                         ELSE 'newest'::text
                     END
                     ELSE search_threads.sort
                 END AS s
            FROM k
         ), tsq AS MATERIALIZED (
          SELECT
                 CASE
                     WHEN ( SELECT k.has_q
                        FROM k) THEN websearch_to_tsquery(search_lang(), q)
                     ELSE NULL::tsquery
                 END AS t
         ), au AS MATERIALIZED (
          SELECT
                 CASE
                     WHEN (author IS NULL) THEN NULL::uuid
                     WHEN (EXISTS ( SELECT 1
                        FROM characters_public c
                       WHERE (c.id = search_threads.author))) THEN author
                     ELSE '00000000-0000-0000-0000-000000000000'::uuid
                 END AS id
         ), c AS MATERIALIZED (
          SELECT ((after ->> 'rank'::text))::double precision AS rank,
             ((after ->> 'at'::text))::timestamp with time zone AS at,
             ((after ->> 'act'::text))::uuid AS act
           WHERE (after IS NOT NULL)
         ), m AS MATERIALIZED (
          SELECT search_matches.act,
             search_matches.thread,
             search_matches.board,
             search_matches.title,
             search_matches."character",
             search_matches.created_at,
             search_matches.words
            FROM search_matches(search_threads.q, ( SELECT au.id
                    FROM au), search_threads.board, search_threads.from_at, search_threads.to_at, COALESCE(search_threads.titles_only, false), true, NULL::timestamp with time zone, NULL::uuid,
                 CASE
                     WHEN (( SELECT cfg.s
                        FROM cfg) = 'relevance'::text) THEN (( SELECT cfg.pool
                        FROM cfg) + 1)
                     ELSE 0
                 END) search_matches(act, thread, board, title, "character", created_at, words)
         ), ranked AS MATERIALIZED (
          SELECT x.act,
             x.thread,
             x.board,
             x.title,
             x."character",
             x.created_at,
             x.words,
             x.rn,
             (ts_rank_cd(x.words, ( SELECT tsq.t
                    FROM tsq), 1))::double precision AS rank
            FROM ( SELECT m.act,
                     m.thread,
                     m.board,
                     m.title,
                     m."character",
                     m.created_at,
                     m.words,
                     row_number() OVER (ORDER BY m.created_at DESC, m.act DESC) AS rn
                    FROM m) x
           WHERE (x.rn <= ( SELECT cfg.pool
                    FROM cfg))
         ), best AS MATERIALIZED (
          SELECT DISTINCT ON (r.thread) r.act,
             r.thread,
             r.board,
             r.title,
             r."character",
             r.created_at,
             r.rank
            FROM ranked r
           ORDER BY r.thread, r.rank DESC, r.created_at DESC, r.act DESC
         ), walk AS MATERIALIZED (
          SELECT search_walk.act,
             search_walk.thread,
             search_walk.board,
             search_walk.title,
             search_walk."character",
             search_walk.created_at,
             search_walk.stop
            FROM search_walk(search_threads.q, ( SELECT au.id
                    FROM au), search_threads.board, search_threads.from_at, search_threads.to_at, COALESCE(search_threads.titles_only, false), ( SELECT (cfg.s <> 'oldest'::text)
                    FROM cfg), ( SELECT c.at
                    FROM c), ( SELECT c.act
                    FROM c),
                 CASE
                     WHEN (( SELECT cfg.s
                        FROM cfg) = 'relevance'::text) THEN 0
                     ELSE (( SELECT cfg.pp
                        FROM cfg) + 1)
                 END, ( SELECT cfg.pool
                    FROM cfg)) search_walk(act, thread, board, title, "character", created_at, stop)
         ), walked AS MATERIALIZED (
          SELECT w.act,
             w.thread,
             w.board,
             w.title,
             w."character",
             w.created_at,
             (0)::double precision AS rank
            FROM walk w
           WHERE (NOT w.stop)
         ), cnt AS MATERIALIZED (
          SELECT count(*) FILTER (WHERE (NOT w.stop)) AS n,
             COALESCE(bool_or(w.stop), false) AS cut
            FROM search_walk(search_threads.q, ( SELECT au.id
                    FROM au), search_threads.board, search_threads.from_at, search_threads.to_at, COALESCE(search_threads.titles_only, false), true, NULL::timestamp with time zone, NULL::uuid, 1001, ( SELECT cfg.pool
                    FROM cfg)) w(act, thread, board, title, "character", created_at, stop)
         ), found AS MATERIALIZED (
          SELECT best.act,
             best.thread,
             best.board,
             best.title,
             best."character",
             best.created_at,
             best.rank
            FROM best
         UNION ALL
          SELECT walked.act,
             walked.thread,
             walked.board,
             walked.title,
             walked."character",
             walked.created_at,
             walked.rank
            FROM walked
         ), page AS MATERIALIZED (
          SELECT b.act,
             b.thread,
             b.board,
             b.title,
             b."character",
             b.created_at,
             b.rank,
             row_number() OVER (ORDER BY b.rank DESC,
                 CASE
                     WHEN (cfg.s = 'oldest'::text) THEN b.created_at
                     ELSE NULL::timestamp with time zone
                 END,
                 CASE
                     WHEN (cfg.s <> 'oldest'::text) THEN b.created_at
                     ELSE NULL::timestamp with time zone
                 END DESC,
                 CASE
                     WHEN (cfg.s = 'oldest'::text) THEN b.act
                     ELSE NULL::uuid
                 END,
                 CASE
                     WHEN (cfg.s <> 'oldest'::text) THEN b.act
                     ELSE NULL::uuid
                 END DESC) AS n
            FROM found b,
             cfg
           WHERE ((cfg.s <> 'relevance'::text) OR (NOT (EXISTS ( SELECT 1
                    FROM c))) OR (ROW(b.rank, b.created_at, b.act) < ROW(( SELECT c.rank
                    FROM c), ( SELECT c.at
                    FROM c), ( SELECT c.act
                    FROM c))))
           ORDER BY (row_number() OVER (ORDER BY b.rank DESC,
                 CASE
                     WHEN (cfg.s = 'oldest'::text) THEN b.created_at
                     ELSE NULL::timestamp with time zone
                 END,
                 CASE
                     WHEN (cfg.s <> 'oldest'::text) THEN b.created_at
                     ELSE NULL::timestamp with time zone
                 END DESC,
                 CASE
                     WHEN (cfg.s = 'oldest'::text) THEN b.act
                     ELSE NULL::uuid
                 END,
                 CASE
                     WHEN (cfg.s <> 'oldest'::text) THEN b.act
                     ELSE NULL::uuid
                 END DESC))
          LIMIT (( SELECT cfg_1.pp
                    FROM cfg cfg_1) + 1)
         ), shown AS MATERIALIZED (
          SELECT p.act,
             p.thread,
             p.board,
             p.title,
             p."character",
             p.created_at,
             p.rank,
             p.n
            FROM page p
           WHERE (p.n <= ( SELECT cfg.pp
                    FROM cfg))
         ), people AS MATERIALIZED (
          SELECT cp.id,
             cp.name
            FROM characters_public cp
           WHERE (cp.id IN ( SELECT s."character"
                    FROM shown s))
         ), places AS MATERIALIZED (
          SELECT b.id,
             b.slug,
             b.name
            FROM boards_now b
           WHERE (b.id IN ( SELECT s.board
                    FROM shown s))
         )
  SELECT jsonb_build_object('count', ( SELECT cnt.n
            FROM cnt), 'more', ((( SELECT cnt.n
            FROM cnt) > 1000) OR ( SELECT cnt.cut
            FROM cnt)), 'pooled', ((( SELECT cfg.s
            FROM cfg) = 'relevance'::text) AND (( SELECT count(*) AS count
            FROM m) > ( SELECT cfg.pool
            FROM cfg))), 'results', COALESCE(( SELECT jsonb_agg(jsonb_build_object('thread', s.thread, 'title', s.title, 'board', s.board, 'board_slug', pl.slug, 'board_name', pl.name, 'act', s.act, 'seq', a.seq, 'page', (GREATEST((1)::numeric, ceil(((a.seq)::numeric / (( SELECT cfg.thread_pp
                    FROM cfg))::numeric))))::integer, 'character', s."character", 'name', pe.name, 'created_at', s.created_at, 'snippet',
                 CASE
                     WHEN (( SELECT tsq.t
                        FROM tsq) IS NULL) THEN "left"(regexp_replace(bbcode_plain((a.current_payload ->> 'body'::text)), '\s+'::text, ' '::text, 'g'::text), 200)
                     ELSE ts_headline(search_lang(), bbcode_plain((a.current_payload ->> 'body'::text)), ( SELECT tsq.t
                        FROM tsq), 'StartSel=<<,StopSel=>>,MaxFragments=1,MaxWords=30,MinWords=12'::text)
                 END, 'matches', LEAST(h.n, (100)::bigint), 'matches_more', (h.n > 100)) ORDER BY s.n) AS jsonb_agg
            FROM ((((shown s
              JOIN acts_public a ON ((a.id = s.act)))
              LEFT JOIN people pe ON ((pe.id = s."character")))
              LEFT JOIN places pl ON ((pl.id = s.board)))
              CROSS JOIN LATERAL ( SELECT search_thread_matches(s.thread, ( SELECT tsq.t
                            FROM tsq), ( SELECT au.id
                            FROM au), search_threads.from_at, search_threads.to_at, COALESCE(search_threads.titles_only, false)) AS n) h)), '[]'::jsonb), 'next', COALESCE(( SELECT jsonb_build_object('rank', p.rank, 'at', p.created_at, 'act', p.act) AS jsonb_build_object
            FROM page p
           WHERE ((p.n = ( SELECT cfg.pp
                    FROM cfg)) AND (EXISTS ( SELECT 1
                    FROM page x
                   WHERE (x.n = (( SELECT cfg.pp
                            FROM cfg) + 1)))))), ( SELECT jsonb_build_object('rank', 0, 'at', w.created_at, 'act', w.act) AS jsonb_build_object
            FROM walk w
           WHERE w.stop))) AS jsonb_build_object
  );
end
$function$;

create or replace function public.season_news(before timestamp with time zone DEFAULT NULL::timestamp with time zone, most integer DEFAULT 20)
 returns setof season_news_row
 language plpgsql
 stable security definer
 set search_path to 'public', 'pg_temp'
 set plan_cache_mode = force_generic_plan
 set jit = off
as $function$
#variable_conflict use_column
begin
  return query
  with
  lim as (select coalesce($1, 'infinity'::timestamptz) as b, greatest(1, least(coalesce($2, 20), 50)) as k),
  ann as (select (select (s.value #>> '{}')::uuid from settings s where s.key = 'systemAnnouncements') as thread),
  r_floor as (
    select coalesce((select s.results_at from seasons s where s.results_at is not null and s.results_at < (select b from lim)
                     order by s.results_at desc, s.number desc offset (select k - 1 from lim) limit 1), '-infinity'::timestamptz) as at
  ),
  results as (
    select 'results'::text as kind, null::uuid as act, null::uuid as thread, null::integer as seq, s.results_at as at, s.number as season,
           null::text as name, null::text as quote, coalesce(s.results_count, 0) as count,
           jsonb_build_object('top', (
             select coalesce(jsonb_agg(jsonb_build_object('character', t.character, 'name', t.name, 'place', t.place, 'standing', t.standing, 'shown', t.shown)
                                       order by t.place, t.name, t.character), '[]'::jsonb)
             from (select r.* from season_results r where r.season = s.id and r.standing > 0 and r.place is not null order by r.standing desc, r.name, r.character limit 3) t)) as detail
    from seasons s
    where s.results_at is not null and s.results_at < (select b from lim) and s.results_at >= (select at from r_floor)
  ),
  t_floor as (
    select coalesce((select n.landed_at from news_landed n where n.kind in ('tally', 'announcements') and n.landed_at < (select b from lim)
                     order by n.landed_at desc, n.act desc offset (select k - 1 from lim) limit 1), '-infinity'::timestamptz) as at
  ),
  tallies as (
    select 'tally'::text as kind, a.id as act, a.thread, a.seq, n.landed_at as at,
           case when n.kind = 'tally' then (a.payload ->> 'season')::integer else (select s.number from seasons s where s.turns_thread = a.thread) end as season,
           null::text as name, null::text as quote,
           case when n.kind = 'tally' then tally_names(a.payload)
                else (select count(*) from acts x where x.kind = 'announce' and x.thread = a.thread and x.created_at = a.created_at)::integer end as count,
           case when n.kind = 'tally' then
             jsonb_build_object('debuts', case when jsonb_typeof(a.payload -> 'debuts') = 'array' then a.payload -> 'debuts' else '[]'::jsonb end,
                                'turns', case when jsonb_typeof(a.payload -> 'turns') = 'array' then a.payload -> 'turns' else '[]'::jsonb end)
           else (
             select jsonb_build_object(
               'debuts', coalesce(jsonb_agg(f.entry order by f.seq) filter (where f.what = 'debut'), '[]'::jsonb),
               'turns', coalesce(jsonb_agg(f.entry order by f.seq) filter (where f.what = 'turn'), '[]'::jsonb))
             from (
               select x.seq, x.payload ->> 'what' as what,
                      jsonb_build_object('character', x.character, 'name', c.name)
                        || case when x.payload ? 'class' then jsonb_build_object('class', x.payload -> 'class') else '{}'::jsonb end
                        || case when x.payload ? 'was' then jsonb_build_object('was', x.payload -> 'was') else '{}'::jsonb end as entry
               from acts x join characters c on c.id = x.character
               where x.kind = 'announce' and x.thread = a.thread and x.created_at = a.created_at
               order by x.seq limit 20
             ) f) end as detail
    from news_landed n join acts a on a.id = n.act
    where n.kind in ('tally', 'announcements') and n.landed_at < (select b from lim) and n.landed_at >= (select at from t_floor)
  ),
  boss_all as materialized (
    select 'bossArrived'::text as kind, h.boss as who, h.landed_at as at, h.number as season, 'bossArrival'::text as line from season_boss_changes h
    where h.landed_at < (select b from lim)
    union all
    select 'bossLeft', h.outgoing, h.landed_at, h.number - 1, 'bossFarewell' from season_boss_changes h
    where h.outgoing is not null and h.landed_at < (select b from lim)
  ),
  boss_page as (
    select * from boss_all c
    where c.at >= coalesce((select c2.at from boss_all c2 order by c2.at desc offset (select k - 1 from lim) limit 1), '-infinity'::timestamptz)
  ),
  bosses as (
    select c.kind, p.id as act, p.thread, p.seq, c.at, c.season, (select ch.name from characters ch where ch.staff = c.who) as name,
           left(p.body, 600) as quote, null::integer as count, null::jsonb as detail
    from boss_page c
    left join lateral (
      select a.id, a.thread, a.seq, public_payload(a.payload, version_hidden(a.id), a.id) ->> 'body' as body
      from characters ch join acts a on a.character = ch.id
      where ch.staff = c.who and a.created_at = c.at and a.kind = 'post' and a.thread = (select thread from ann)
        and exists (select 1 from settings s where s.key = 'systemLines' and jsonb_typeof(s.value -> c.line) = 'array' and jsonb_array_length(s.value -> c.line) > 0)
      order by a.seq limit 1
    ) p on true
  ),
  merged as (
    select * from results union all select * from tallies union all select * from bosses
  )
  select m.kind, m.act, m.thread, m.seq, m.at, m.season, m.name, m.quote, m.count, m.detail
  from merged m
  where m.at >= coalesce((select m2.at from merged m2 order by m2.at desc offset (select k - 1 from lim) limit 1), '-infinity'::timestamptz)
  order by m.at desc, m.kind, m.act nulls first;
end
$function$;

create or replace function public.season_page(in_tab text, in_season integer, in_character uuid, in_page integer)
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
  WITH cur AS (
          SELECT s.number
            FROM current_season s
          LIMIT 1
         ), fin AS (
          SELECT f.number,
             f.starts_at,
             f.ends_at,
             f.results_at,
             f.characters
            FROM finished_seasons() f(number, starts_at, ends_at, results_at, characters)
         ), mode AS (
          SELECT
                 CASE
                     WHEN (in_tab = 'news'::text) THEN 'news'::text
                     WHEN ((in_season IS NULL) OR (NOT (in_season IS DISTINCT FROM ( SELECT c.number
                        FROM cur c)))) THEN 'standings'::text
                     WHEN (EXISTS ( SELECT 1
                        FROM fin f
                       WHERE (f.number = season_page.in_season))) THEN 'results'::text
                     ELSE 'missing'::text
                 END AS m
         ), pl AS (
          SELECT
                 CASE
                     WHEN ((( SELECT mode.m
                        FROM mode) = 'results'::text) AND (in_character IS NOT NULL)) THEN result_place(in_season, in_character)
                     ELSE NULL::integer
                 END AS place
         ), pg AS (
          SELECT
                 CASE
                     WHEN (in_page IS NOT NULL) THEN LEAST(GREATEST(in_page, 1), 10000)
                     ELSE LEAST(GREATEST(COALESCE(((( SELECT pl.place
                        FROM pl) / 50) + 1), 1), 1), 10000)
                 END AS page
         ), st AS (
          SELECT s."character",
             s.name,
             s.standing,
             s.place,
             s.n
            FROM standings_page(((( SELECT pg.page
                    FROM pg) - 1) * 50),
                 CASE
                     WHEN (( SELECT mode.m
                        FROM mode) = 'standings'::text) THEN 50
                     ELSE 0
                 END) WITH ORDINALITY s("character", name, standing, place, n)
         ), rs AS (
          SELECT r."character",
             r.name,
             r.place,
             r.standing,
             r.shown,
             r.n
            FROM results_page(
                 CASE
                     WHEN (( SELECT mode.m
                        FROM mode) = 'results'::text) THEN season_page.in_season
                     ELSE NULL::integer
                 END, ( SELECT pg.page
                    FROM pg)) WITH ORDINALITY r("character", name, place, standing, shown, n)
         ), nw AS (
          SELECT n.ordinality AS o,
             (to_jsonb(n.*) - 'ordinality'::text) AS item
            FROM season_news(NULL::timestamp with time zone, 20) WITH ORDINALITY n(kind, act, thread, seq, at, season, name, quote, count, detail, ordinality)
           WHERE (( SELECT mode.m
                    FROM mode) = 'news'::text)
         )
  SELECT
         CASE ( SELECT mode.m
                FROM mode)
             WHEN 'missing'::text THEN NULL::jsonb
             WHEN 'news'::text THEN jsonb_build_object('season', ( SELECT to_jsonb(s.*) AS to_jsonb
                FROM current_season s
              LIMIT 1), 'news', COALESCE(( SELECT jsonb_agg(x.item ORDER BY x.o) AS jsonb_agg
                FROM nw x), '[]'::jsonb))
             WHEN 'standings'::text THEN jsonb_build_object('season', ( SELECT to_jsonb(s.*) AS to_jsonb
                FROM current_season s
              LIMIT 1), 'finished', COALESCE(( SELECT jsonb_agg(to_jsonb(f.*) ORDER BY f.number DESC) AS jsonb_agg
                FROM fin f), '[]'::jsonb), 'page', ( SELECT pg.page
                FROM pg), 'standings', COALESCE(( SELECT jsonb_agg((to_jsonb(x.*) - 'n'::text) ORDER BY x.n) AS jsonb_agg
                FROM st x), '[]'::jsonb), 'size', ( SELECT z.characters
                FROM season_size z
              LIMIT 1), 'reveals', COALESCE(( SELECT jsonb_agg(to_jsonb(r.*) ORDER BY r.at, ((r.act)::text COLLATE "C")) AS jsonb_agg
                FROM ( SELECT v.act,
                         v."character",
                         v.class,
                         v.at,
                         v.via,
                         v.thread
                        FROM class_reveals v
                       WHERE (v."character" IN ( SELECT x."character"
                                FROM st x))) r), '[]'::jsonb), 'turns', COALESCE(( SELECT jsonb_agg(to_jsonb(t.*) ORDER BY t.at, ((t.act)::text COLLATE "C")) AS jsonb_agg
                FROM ( SELECT u.act,
                         u."character",
                         u.at,
                         u.was
                        FROM turns_announced u
                       WHERE (u."character" IN ( SELECT x."character"
                                FROM st x))) t), '[]'::jsonb))
             ELSE jsonb_build_object('season', ( SELECT to_jsonb(s.*) AS to_jsonb
                FROM current_season s
              LIMIT 1), 'finished', COALESCE(( SELECT jsonb_agg(to_jsonb(f.*) ORDER BY f.number DESC) AS jsonb_agg
                FROM fin f), '[]'::jsonb), 'page', ( SELECT pg.page
                FROM pg), 'place', ( SELECT pl.place
                FROM pl), 'results', COALESCE(( SELECT jsonb_agg((to_jsonb(x.*) - 'n'::text) ORDER BY x.n) AS jsonb_agg
                FROM rs x), '[]'::jsonb))
         END AS jsonb_build_object
  );
end
$function$;

create or replace function public.staff_career(of_staff text)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public', 'pg_temp'
 set plan_cache_mode = force_generic_plan
 set jit = off
as $function$
#variable_conflict use_column
begin
  return (
  select jsonb_build_object(
    'led', coalesce((
      select jsonb_agg(jsonb_build_object('season', s.number, 'since', to_char((s.starts_at) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'), 'until', to_char((s.ends_at) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'), 'how', case when s.number = (select min(number) from seasons) then 'seed' else h.how end) order by s.number)
      from seasons s left join season_handovers h on h.season = s.id
      where s.boss = of_staff and exists (select 1 from characters c where c.staff = of_staff and c.staff_kind = 'persona')
    ), '[]'::jsonb),
    'offices', coalesce((
      select jsonb_agg(jsonb_build_object('office', o.office, 'since', to_char((o.at) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'), 'until', to_char((select min(t) from (values (o.next_at), ((
          select min(s.starts_at) from seasons s where s.boss = of_staff and s.starts_at > o.at))) v(t)) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'), 'cause', o.cause) order by o.id)
      from (select r.id, r.office, r.at, r.cause, lead(r.at) over (order by r.id) as next_at from staff_offices r where r.staff = of_staff) o
    ), '[]'::jsonb))
  );
end
$function$;

create or replace function public.standings_page(page_offset integer, page_limit integer)
 returns table("character" uuid, name text, standing integer, place bigint)
 language plpgsql
 stable security definer
 set search_path to 'public', 'pg_temp'
 set plan_cache_mode = force_generic_plan
 set jit = off
as $function$
#variable_conflict use_column
begin
  return query
  with recursive start as materialized (
    select s.amount, s.name from standings s
    where s.season = (select standings_season())
    order by s.amount desc, s.name
    offset greatest(page_offset, 0) limit 1
  ), page as materialized (
    select x.character, x.name, x.amount, row_number() over (order by x.amount desc, x.name) as n
    from ((select s.character, s.name, s.amount from standings s
           where s.season = (select standings_season()) and s.amount = (select amount from start) and s.name >= (select name from start)
           order by s.name limit least(greatest(page_limit, 0), 1000))
          union all
          (select s.character, s.name, s.amount from standings s
           where s.season = (select standings_season()) and s.amount < (select amount from start)
           order by s.amount desc, s.name limit least(greatest(page_limit, 0), 1000))) x
    order by x.amount desc, x.name
    limit least(greatest(page_limit, 0), 1000)
  ), above(amount) as (
    (select s.amount from standings s where s.season = (select standings_season()) and s.amount > (select amount from start) and (select amount from start) > 0
     order by s.amount desc limit 1)
    union all
    select (select s.amount from standings s
            where s.season = (select standings_season()) and s.amount > (select amount from start) and s.amount < a.amount order by s.amount desc limit 1)
    from above a where a.amount is not null
  ), head as materialized (
    select 1 + (select count(a.amount) from above a) as place
  )
  select p.character, p.name, p.amount, case when p.amount > 0 then h.place + dense_rank() over (order by p.amount desc) - 1 end
  from page p cross join head h
  order by p.n;
end
$function$;

create or replace function public.surface_acts(play uuid)
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
  select case when s.play is null then null else jsonb_build_object(
    'covered', bit_count(s.cover),
    'acts', coalesce((select jsonb_agg((to_jsonb(a) #- '{payload,cells}' #- '{current_payload,cells}') || case when a.kind = 'draw' then jsonb_build_object('share', coalesce(sh.n, 0)) else '{}'::jsonb end order by u.ord)
                      from unnest(s.live) with ordinality u(id, ord) join acts_public a on a.id = u.id
                      left join (select o.o, count(*) as n from unnest(s.owners) o(o) where o.o <> 0 group by o.o) sh on sh.o = u.ord), '[]'::jsonb),
    'older', (select count(*) from acts_public d where d.target_act_id = s.play and d.kind = 'draw' and d.id <> all (s.live))) end
  from (select 1) x left join surfaces s on s.play = surface_acts.play
  );
end
$function$;

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
         ), ids AS MATERIALIZED (
          SELECT a.id
            FROM page_acts a
         UNION
          SELECT n.id
            FROM nested n
         UNION
          SELECT p.id
            FROM played p
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
                FROM page_acts a), 'people', ( SELECT COALESCE(jsonb_agg(jsonb_build_object('character', jsonb_build_object('id', c.id, 'name', c.name, 'joined', c.joined, 'staff', c.staff, 'office', c.office, 'warn_points', c.warn_points, 'banned_until', c.banned_until, 'group', c."group"), 'profile', ( SELECT (jsonb_build_object('character', p."character", 'title', p.title, 'signature', p.signature, 'avatar_square', p.avatar_square, 'avatar_portrait', p.avatar_portrait, 'square_frame', p.square_frame, 'portrait_frame', p.portrait_frame, 'pip_style', p.pip_style, 'pronouns', p.pronouns) || profile_cosmetics(p."character"))
                        FROM character_profiles p
                       WHERE (p."character" = c.id)), 'posts', COALESCE(( SELECT n.posts
                        FROM character_post_counts n
                       WHERE (n."character" = c.id)), 0), 'standing', COALESCE(( SELECT st.standing
                        FROM current_standings st
                       WHERE (st."character" = c.id)), 0), 'reveals', ( SELECT COALESCE(jsonb_agg(jsonb_build_object('act', r.act, 'character', r."character", 'class', r.class, 'at', r.at, 'via', r.via, 'thread', r.thread) ORDER BY r.at, r.act), '[]'::jsonb) AS "coalesce"
                        FROM class_reveals r
                       WHERE (r."character" = c.id)), 'turns', ( SELECT COALESCE(jsonb_agg(jsonb_build_object('act', u.act, 'character', u."character", 'at', u.at, 'was', u.was) ORDER BY u.at, u.act), '[]'::jsonb) AS "coalesce"
                        FROM turns_announced u
                       WHERE (u."character" = c.id))) ORDER BY c.id), '[]'::jsonb) AS "coalesce"
                FROM characters_public c
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
                        FROM rng))), 'following', following_thread(in_thread), 'presence', presence_box('thread'::text, in_thread), 'unread', my_alerts_unread())
         END AS jsonb_build_object
  );
end
$function$;

create or replace function public.trophies_of(of_character uuid, before timestamp with time zone DEFAULT NULL::timestamp with time zone, most integer DEFAULT 50, before_id uuid DEFAULT NULL::uuid)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public', 'pg_temp'
 set plan_cache_mode = force_generic_plan
 set jit = off
as $function$
#variable_conflict use_column
begin
  return (
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
  );
end
$function$;

create or replace function public.updates(before timestamp with time zone DEFAULT NULL::timestamp with time zone, most integer DEFAULT 20)
 returns setof updates_read
 language plpgsql
 stable security definer
 set search_path to 'public', 'pg_temp'
 set plan_cache_mode = force_generic_plan
 set jit = off
as $function$
#variable_conflict use_column
begin
  return query
  select * from updates_read u where u.at < coalesce($1, 'infinity'::timestamptz) order by u.at desc, u.act desc limit greatest(1, least(coalesce($2, 20), 50));
end
$function$;

create or replace function public.updates_page(in_update uuid, in_before timestamp with time zone, in_handover_season integer)
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
  WITH up AS (
          SELECT (to_jsonb(u.*) - 'ordinality'::text) AS j,
             u.ordinality AS o
            FROM updates(updates_page.in_before, 20) WITH ORDINALITY u(act, thread, "character", name, tagline, avatar, title, body, changes, at, seq, pronouns, ordinality)
         ), open AS (
          SELECT COALESCE(( SELECT ((up.j ->> 'act'::text))::uuid AS uuid
                    FROM up
                   WHERE (((up.j ->> 'act'::text))::uuid = updates_page.in_update)), ( SELECT ((up.j ->> 'act'::text))::uuid AS uuid
                    FROM up
                   ORDER BY up.o
                  LIMIT 1)) AS act
         )
  SELECT (jsonb_build_object('updates', COALESCE(( SELECT jsonb_agg(up.j ORDER BY up.o) AS jsonb_agg
            FROM up), '[]'::jsonb), 'tallies', COALESCE(( SELECT jsonb_agg(to_jsonb(t.*) ORDER BY t.kind) AS jsonb_agg
            FROM ( SELECT r.act,
                     r.kind,
                     r.count
                    FROM reaction_tallies r
                   WHERE (r.act = ( SELECT open.act
                            FROM open))) t), '[]'::jsonb), 'mine', COALESCE(( SELECT jsonb_agg(to_jsonb(m.*) ORDER BY m.kind, ((m."character")::text COLLATE "C")) AS jsonb_agg
            FROM ( SELECT r.act,
                     r.kind,
                     r."character"
                    FROM my_reactions r
                   WHERE (r.act = ( SELECT open.act
                            FROM open))) m), '[]'::jsonb)) ||
         CASE
             WHEN ((in_handover_season IS NOT NULL) AND COALESCE(is_admin(), false)) THEN jsonb_build_object('queue', admin_queue())
             ELSE '{}'::jsonb
         END)
  );
end
$function$;

create or replace function public.visit_quiz(visit uuid)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public', 'pg_temp'
 set plan_cache_mode = force_generic_plan
 set jit = off
as $function$
#variable_conflict use_column
begin
  return (
  select jsonb_build_object('question', q.question, 'choices', q.choices)
  from acts v join characters c on c.id = v.character join staff_quiz_questions q on q.staff = c.staff and q.idx = (v.payload #>> '{challenge,question_index}')::integer
  where v.id = visit_quiz.visit and v.kind = 'visit'
  );
end
$function$;

create or replace function public.whoami()
 returns uuid
 language plpgsql
 stable security definer
 set search_path to 'public', 'pg_temp'
 set plan_cache_mode = force_generic_plan
 set jit = off
as $function$
#variable_conflict use_column
begin
  return (
  select a.id from accounts a where a.id = auth.uid()
  );
end
$function$;

-- ---- 2. Already plpgsql: the plan is set ----

alter function public.admin_awards(timestamp with time zone,integer,uuid) set plan_cache_mode = force_generic_plan;
alter function public.admin_awards(timestamp with time zone,integer,uuid) set jit = off;
alter function public.admin_character_named(text) set plan_cache_mode = force_generic_plan;
alter function public.admin_character_named(text) set jit = off;
alter function public.admin_failed_mail() set plan_cache_mode = force_generic_plan;
alter function public.admin_failed_mail() set jit = off;
alter function public.admin_machine() set plan_cache_mode = force_generic_plan;
alter function public.admin_machine() set jit = off;
alter function public.admin_queue() set plan_cache_mode = force_generic_plan;
alter function public.admin_queue() set jit = off;
alter function public.admin_reports() set plan_cache_mode = force_generic_plan;
alter function public.admin_reports() set jit = off;
alter function public.belt_lineage(text,timestamp with time zone,integer,uuid) set plan_cache_mode = force_generic_plan;
alter function public.belt_lineage(text,timestamp with time zone,integer,uuid) set jit = off;
alter function public.boss_roster_names() set plan_cache_mode = force_generic_plan;
alter function public.boss_roster_names() set jit = off;
alter function public.drive_gifts(uuid[]) set plan_cache_mode = force_generic_plan;
alter function public.drive_gifts(uuid[]) set jit = off;
alter function public.effects_above(uuid[],uuid,uuid) set plan_cache_mode = force_generic_plan;
alter function public.effects_above(uuid[],uuid,uuid) set jit = off;
alter function public.following_thread(uuid) set plan_cache_mode = force_generic_plan;
alter function public.following_thread(uuid) set jit = off;
alter function public.move_progress(uuid) set plan_cache_mode = force_generic_plan;
alter function public.move_progress(uuid) set jit = off;
alter function public.my_hidden_version(uuid) set plan_cache_mode = force_generic_plan;
alter function public.my_hidden_version(uuid) set jit = off;
alter function public.next_settlement_at(timestamp with time zone) set plan_cache_mode = force_generic_plan;
alter function public.next_settlement_at(timestamp with time zone) set jit = off;
alter function public.play_moment(uuid) set plan_cache_mode = force_generic_plan;
alter function public.play_moment(uuid) set jit = off;
alter function public.post_tails(uuid[]) set plan_cache_mode = force_generic_plan;
alter function public.post_tails(uuid[]) set jit = off;
alter function public.presence_box(text,uuid) set plan_cache_mode = force_generic_plan;
alter function public.presence_box(text,uuid) set jit = off;
alter function public.screen_refusal(text) set plan_cache_mode = force_generic_plan;
alter function public.screen_refusal(text) set jit = off;
alter function public.spin_moment(uuid) set plan_cache_mode = force_generic_plan;
alter function public.spin_moment(uuid) set jit = off;
alter function public.standing_place(uuid) set plan_cache_mode = force_generic_plan;
alter function public.standing_place(uuid) set jit = off;
alter function public.trophy_award_failures(timestamp with time zone,integer,uuid,boolean) set plan_cache_mode = force_generic_plan;
alter function public.trophy_award_failures(timestamp with time zone,integer,uuid,boolean) set jit = off;
