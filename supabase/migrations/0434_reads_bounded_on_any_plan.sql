-- Reads that are bounded on any plan, not only on the plan the planner usually picks (the regression on main at 7d8a255, issue #1080).
-- Main's Release run of 7d8a255 failed three read-cost guards that its PR had passed on the same code: 0424's requests_waiting(1) read 438 rows of `acts` for 51 requests, 0425's pool_read 1924 in a 4,000-post thread and 0426's pool_read
-- 4814. Each guard counts the rows of `acts` a read takes; the code had not changed between the runs, only what the planner chose. Two reads had a plan that is not bounded by their keys:
--
--   1. acts_public's author-veil check (0395, section 8). Each of its first two selects asks, for each Act, whether a live author veil covers it: `exists (select 1 from post_veil_cover c join post_veils_live v on ... where c.act = a.id)`,
--      post_veils_live being every veil not yet over, not ended by a card_end Act and not refunded. Postgres may run that EXISTS as a hashed subplan: it reads every live veil, and for each one every card_end Act of the instance (an anti join
--      by acts_one_card_end), builds a hash of the result and probes it with the Act's id. That is done once for each statement that reads acts_public, so a probe of one post by its id (pool_probe, staff_request_shown, post_extras, ...)
--      reads live veils x card_end Acts rows of `acts` before it reads its post. With 8 live author veils and 200 card_end Acts, one probe of a post nobody veiled read 1604 rows of `acts` with true statistics (the planner picks the
--      hash while the veils are few, which is the usual state of a live instance, whose card_end Acts never stop growing). CI's runs had about 9 card_end Acts and 8 veils, so each probe read about 9 rows more than its key: 0426's
--      read probes about 250 posts and plays (4814 against 2546), 0424's 51 requests (438 against the bound of 306), 0425's about 200 posts (1924 against 1500).
--      Rebuilt here around one check that no planner can hash, author_veil_live(play): post_veils_live's rule for one veil (author, not over, not ended, not refunded), each part read by its key (post_veils_pkey; card_end_written,
--      which reads acts_one_card_end under 0425's settings and in its own order, so that acts_card_ends' scan with a filter costs a disabled node; card_write_refunds_pkey). acts_public's first two selects ask
--      author_veil_covers(act) of each Act, a loop of author_veil_live over the Act's rows of post_veil_cover read by their key (act, play), so that an Act no veil covers costs one probe of post_veil_cover and no row of `acts`.
--      acts_public is otherwise 0395's, word for word.
--   2. The stand-in's own Acts (the owner's answer on #1107). Read through acts_public by the stand-in, as profile_page and record_page read every character's, they were a walk of every Act of the instance that 0395's hashed
--      set made nearly free and item 1's per-Act check makes a probe each (3,175 buffers for 0304's newest five). The two pages now read the stand-in's Acts from stand_in_acts, which starts from the live author veils, and
--      every other character's as before; what each shows is unchanged (section 3 below).
--   3. pool_own_post_ids and pool_reply_ids (0425), issue #1080. 0425 left one path with no disabled node besides each helper's ordered index: acts_patrol_posts (thread, created_at desc, id desc) gives the thread's posts in the order
--      the helpers ask for, with the character (or the target) as a filter, so a planner that priced it below the ordered index read the thread's posts until it had n. Under empty statistics every candidate is estimated at one row
--      and the cheaper is the smaller index, which acts_patrol_posts is: forged empty statistics with relallvisible 0 (the visibility map's count, which 0425's test did not forge, and which the files before it leave as they leave it)
--      read 1241 rows in a 4,000-post thread and 941 in a 1,000-post one, #1080's own numbers.
--      Rebuilt here so that no other path is free of a disabled node: the character (or the target) is asked for as a range of one value (`between x and x`), which makes no equivalence class, and the order is asked for with it first
--      (`order by character desc, created_at desc, id desc`; `order by target_act_id, created_at desc, id desc`). Under the helpers' settings (no sequential scan, no bitmap scan, no sort, no incremental sort) that order comes without a
--      disabled node only from an index whose key is it under the query's equalities: acts_thread_posts (thread, character, created_at, id) where kind = 'post', read backward, and acts_target (target_act_id, kind, created_at desc, id
--      desc) where kind <> 'edit'. acts_patrol_posts, acts_character and acts_created each lack a column of it and cost a sort, a disabled node. No other index of `acts` is implied by kind = 'post'. The rows read are the rows returned.
--      Same signatures, owner, settings, grants and result as 0425's.
--   4. play_row (0412), which play_post's upkeep (refresh_play_post) calls for one play: one statement that reads the play by its id, run with no setting of its own, so a planner that thought `acts` small read it whole for
--      each call (0321's author veil landing fetched 11,247 rows of `acts`, with main's definitions too, wherever the suite left `acts`' statistics small: CI's full suite on main happened to pass it, and this file's moved
--      it to 430). play_row now runs with no sequential scan, so its reads by id stay probes by key (79 rows for the same landing), and in plpgsql: as a SQL function with settings of its own (a security definer) it kept
--      its prepared statement across calls, and with no sequential scan that statement names indexes, which 0034 drops before it writes again (`could not open relation with OID`); a plpgsql plan is made again.
--
-- The tests: supabase/tests/0434-reads-bounded-on-any-plan.sql plants the veils and card_end Acts that make the hash cheap (tests.plant_live_veils, supabase/tests/setup/fixtures.sql: 8 live veils and 10 ends, as CI had them, then 200
-- ends) and counts one probe under each statistics state; 0424's, 0425's and 0426's guards now measure in the state that failed on every run, not only on the runs whose earlier files left it: each plants 8 veils and 10 ends first,
-- analyzed before its own rows are written, as the suite's vacuum leaves the earlier files' rows; 0425 and 0426 forge relallvisible 0 with their empty statistics; 0425 leaves 20,000 rolled-back posts' dead entries in `acts`'
-- indexes; and 0426 also bounds the rows of post_veils and post_veil_cover its read takes (Postgres 17 hashed the check there but probed each veil's end by key, so the hash read every veil for each post and almost no `acts`).
-- Each was run red against the definitions before this file, on Postgres 16 and on CI's Postgres 17.
-- Ways out: no state is added. Masks: author_veil_covers answers what acts_public already shows every reader of it (whether an Act is shown under the stand-in), reads no owner, class or reaction, and is executable by the roles that
-- read acts_public, as ballot_secret is.

-- ---------------------------------------------------------------------------------------------------- 1. acts_public ----
-- Whether a live author veil covers the Act `act`: post_veils_live's rule (an author veil whose time has not passed, that no card_end Act ended and whose write was not refunded) for each veil post_veil_cover lists for it, each read
-- by its key. Called once for each Act acts_public reads, in place of 0395's EXISTS, which a planner could hash over every veil and card_end of the instance.
-- Whether a card_end Act ended the play `play`: one probe of acts_one_card_end. Asked as a range of one target in that target's order, under 0425's settings, so that no other index of `acts` serves it without a disabled node:
-- acts_card_ends (created_at desc, id desc) where kind = 'card_end' would read every card_end Act with the target as a filter, and is free of a disabled node for a bare `exists`; ordered by the target it costs a sort.
-- (acts_target, whose key leads with the target, is the other path left, and is a probe by key too.) Its own function so that the settings, which cost a little on each call, are paid only for an Act a live veil covers.
create function card_end_written(play uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp
  set enable_seqscan = off set enable_bitmapscan = off set enable_sort = off set enable_incremental_sort = off as $$
  -- a scalar subquery, not `exists`: Postgres drops an EXISTS subquery's ORDER BY and LIMIT, and with them the order that makes the other paths cost a sort
  select (select e.id from acts e where e.kind = 'card_end' and e.target_act_id between card_end_written.play and card_end_written.play order by e.target_act_id limit 1) is not null
$$;
-- No API role runs it: author_veil_covers, a security definer, calls it as its owner.
revoke execute on function card_end_written(uuid) from public, anon, authenticated, service_role;

-- Both functions below run with no sequential scan: a plpgsql function keeps a generic plan for each of its statements after its fifth call, made under whatever setting its caller had then, so a first reader that let the
-- planner scan the small veils' tables left every later Act's check a scan of them (CI's full suite: 234,112 rows of post_veil_cover for 0426's reads, in a session whose first reads of acts_public scanned). With the
-- setting on each function its plans are its own, and its reads of post_veil_cover, post_veils and card_write_refunds are probes by key whatever the caller allows.
-- Both are priced as what they are, an index probe for each row (cost 1000, about one random page read at the default costs; a plpgsql function is priced 100 unless it says, which is a tenth of that): priced at 100, the planner read
-- pool_signals' `tops` (0420) by the thread alone through acts_thread_seq_key and filtered the window, where at its true price it narrows to the window's posts first (acts_patrol_posts by thread and created_at), as 0420's test asks.
-- Whether the veil play `play` is a live author veil: post_veils_live's rule for one veil (an author veil whose time has not passed, that no card_end Act ended and whose write was not refunded), each part read by its key.
create function author_veil_live(play uuid) returns boolean
language plpgsql stable cost 1000 security definer set search_path = public, pg_temp set enable_seqscan = off as $$
begin
  if author_veil_live.play is null then return false; end if;
  if not exists (select 1 from post_veils v where v.play = author_veil_live.play and v.veil = 'author' and v.ends_at > now()) then return false; end if;
  if card_end_written(author_veil_live.play) then return false; end if;
  return not exists (select 1 from card_write_refunds r where r.play = author_veil_live.play);
end $$;
revoke execute on function author_veil_live(uuid) from public, anon;
grant execute on function author_veil_live(uuid) to authenticated, service_role, kayfabb_digest;

-- Whether a live author veil covers the Act `act`: author_veil_live for each veil post_veil_cover lists for it, read by its key (act, play). acts_public's first two selects ask it of each Act they read.
create function author_veil_covers(act uuid) returns boolean
language plpgsql stable cost 1000 security definer set search_path = public, pg_temp set enable_seqscan = off as $$
declare
  pl uuid;
begin
  if author_veil_covers.act is null then return false; end if;
  for pl in select c.play from post_veil_cover c where c.act = author_veil_covers.act loop
    if author_veil_live(pl) then return true; end if;
  end loop;
  return false;
end $$;
revoke execute on function author_veil_covers(uuid) from public, anon;
grant execute on function author_veil_covers(uuid) to authenticated, service_role, kayfabb_digest;

-- acts_public as 0395 wrote it (section 8), but for the author-veil check of its first two selects: `not author_veil_covers(a.id)` and `author_veil_covers(a.id)` where 0395 had `not exists (...)` and `exists (...)` over post_veil_cover
-- and post_veils_live. The columns, their order and every other expression are 0395's. A read of the stand-in's own Acts through this view tests every Act it walks, one probe each; the two screens that list them read
-- stand_in_acts instead (section 3).
create or replace view acts_public as
  select u.id, u."character", u.kind, u.thread, u.target_act_id, u.seq, u.created_at,
         shown_payload(case when u.secret then '{"secret": true}'::jsonb else u.payload end, h.own, co.refs, co.ready, co.body) as payload,
         shown_payload(coalesce(e.payload, case when u.secret then '{"secret": true}'::jsonb else u.payload end), h.cur, coalesce(cc.refs, co.refs), coalesce(cc.ready, co.ready), coalesce(cc.body, co.body)) as current_payload,
         e.created_at as edited_at,
         case when e.created_at > u.created_at + coalesce(span_interval((select g.value from settings g where g.key = 'editGrace')), interval '0')
           then e.created_at end as shown_edited_at,
         case when u.kind = 'card' then exists (select 1 from card_write_refunds r where r.play = u.id) end as untaken,
         case when u.kind = 'set' then (select f.ends_at from face_down f where f.play = u.id) end as ends_at,
         h.cur as hidden,
         u.kind = 'post' and quote_hidden(u.id) as any_hidden,
         not h.cur and coalesce(cc.refs, co.refs) and not coalesce(cc.ready, co.ready) as concealing,
         h.own as payload_hidden,
         not h.own and co.refs and not co.ready as payload_concealing
  from (
    select a.id, a."character" as "character", a.kind, a.thread, a.target_act_id, a.seq, a.created_at, a.payload,
           true as g, (not author_veil_covers(a.id) and not (a.kind = 'ballot' and ballot_secret(a.target_act_id))) as ok, false as secret
    from acts a
    union all
    select a.id, (select k.id from characters k where k.staff_kind = 'anonymous') as "character", a.kind, a.thread, a.target_act_id, a.seq, a.created_at, a.payload,
           true as g, (author_veil_covers(a.id) and not (a.kind = 'ballot' and ballot_secret(a.target_act_id))) as ok, false as secret
    from acts a
    union all
    select a.id, null::uuid as "character", a.kind, a.thread, a.target_act_id, a.seq, a.created_at, a.payload,
           true as g, (a.kind = 'ballot' and ballot_secret(a.target_act_id)) as ok, true as secret
    from acts a
  ) u
  left join lateral (
    select x.id, x.payload, x.created_at from acts x
    where x.kind = 'edit' and x.target_act_id = u.id
    order by x.created_at desc, x.id desc limit 1
  ) e on u.kind = 'post'
  cross join lateral (
    select o.own, case when e.id is null then o.own else version_hidden(e.id, u.id) end as cur
    from (select u.kind in ('post', 'edit') and version_hidden(u.id, case when u.kind = 'edit' then u.target_act_id else u.id end) as own) o
  ) h
  cross join lateral conceal_layer(u.id) co
  left join lateral conceal_layer(e.id) cc on e.id is not null
  where u.g and u.ok;


-- ---------------------------------------------------------------------------------------------------- 2. the ordered helpers ----
-- 0425's two helpers, same signatures, owner, settings and grants (create or replace keeps them), the n newest ids by (created_at desc, id desc) as before: see this file's header, item 3.
create or replace function pool_own_post_ids(in_thread uuid, by_character uuid, n integer) returns uuid[]
language sql stable security definer set search_path = public, pg_temp set enable_seqscan = off set enable_bitmapscan = off set enable_sort = off set enable_incremental_sort = off as $$
  select coalesce(array(
    select y.id from acts y
    where y.thread = in_thread and y.kind = 'post' and y."character" between by_character and by_character
    order by y."character" desc, y.created_at desc, y.id desc
    limit least(greatest(coalesce(n, 0), 0), 100)), '{}'::uuid[])
$$;
create or replace function pool_reply_ids(in_thread uuid, to_act uuid, n integer) returns uuid[]
language sql stable security definer set search_path = public, pg_temp set enable_seqscan = off set enable_bitmapscan = off set enable_sort = off set enable_incremental_sort = off as $$
  select coalesce(array(
    select y.id from acts y
    where y.target_act_id between to_act and to_act and y.thread = in_thread and y.kind = 'post'
    order by y.target_act_id, y.created_at desc, y.id desc
    limit least(greatest(coalesce(n, 0), 0), 100)), '{}'::uuid[])
$$;

-- ---------------------------------------------------------------------------------------------------- 3. the stand-in's own Acts ----
-- The owner's answer on #1107 (option 3). A listing of the stand-in's Acts through acts_public walks every Act of the instance and, with section 1's per-Act check, pays a probe for each (3,175 buffers for 0304's newest five).
-- profile_page and record_page (0357) read the stand-in's Acts from stand_in_acts instead, and every other character's as before: what each screen shows is unchanged (supabase/tests/0434-reads-bounded-on-any-plan.sql,
-- section 4, holds both pages to the view's read). stand_in_acts starts from the live author veils, so its cost is the Acts those veils cover now, never the instance's history and never `acts` whole:
--   the live author veils, in post_veils_ends' order (veil, ends_at) under no sequential scan, bitmap scan, sort or incremental sort, so that post_veils_pkey or post_veils_post, read with a filter, costs a disabled node;
--   each one's liveness by author_veil_live (by key); its covered Acts by post_veil_cover_by_play (play, act), asked as a range of one play in that order, so that the primary key (act, play) read with a filter costs a sort;
--   each Act by its key; and the page, ordered (created_at desc, id desc) in the function, of what it found.

-- post_veil_cover read by its play: the Acts a veil covers.
create index post_veil_cover_by_play on post_veil_cover (play, act);

-- The ids of the stand-in's Acts of the kinds `kinds`, newest first (created_at desc, id desc), `skip` passed and at most `take`: null when `in_character` is not the stand-in, so a page reads every other character as before.
-- Owned by the migration's role: it reads post_veils, post_veil_cover and acts, which no API role reads. It returns ids that acts_public, which every page reads them through, shows under the stand-in.
create function stand_in_acts(in_character uuid, kinds text[], skip integer, take integer) returns uuid[]
language plpgsql stable security definer set search_path = public, pg_temp
  set enable_seqscan = off set enable_bitmapscan = off set enable_sort = off set enable_incremental_sort = off as $$
declare
  pl uuid;
  x uuid;
  r record;
  seen uuid[] := '{}'::uuid[];
  ids uuid[] := '{}'::uuid[];
  ats timestamptz[] := '{}'::timestamptz[];
begin
  if in_character is null or in_character is distinct from stand_in() then return null; end if;
  if coalesce(take, 0) <= 0 then return '{}'::uuid[]; end if;
  for pl in select v.play from post_veils v where v.veil = 'author' and v.ends_at > now() order by v.veil, v.ends_at loop
    continue when not author_veil_live(pl);
    for x in select c.act from post_veil_cover c where c.play between pl and pl order by c.play, c.act loop
      continue when x = any (seen);
      seen := seen || x;
      select a.created_at, a.kind into r from acts a where a.id = x;
      if r.kind = any (kinds) then ids := ids || x; ats := ats || r.created_at; end if;
    end loop;
  end loop;
  return coalesce(array(select u.id from unnest(ids, ats) as u(id, at) order by u.at desc, u.id desc offset greatest(coalesce(skip, 0), 0) limit take), '{}'::uuid[]);
end $$;
revoke execute on function stand_in_acts(uuid, text[], integer, integer) from public, anon;
grant execute on function stand_in_acts(uuid, text[], integer, integer) to authenticated, service_role;

-- profile_page and record_page as 0357 wrote them, but for the list of Acts: for the stand-in, the Acts stand_in_acts names, read through acts_public by id; for any other character, the read they made before.
create or replace function profile_page(in_character uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
 SET plan_cache_mode TO 'force_generic_plan'
 SET jit TO 'off'
AS $function$
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
         ), sid AS (
          -- the stand-in's newest five, read from the live veils (stand_in_acts, 0434); null for any other character
          SELECT stand_in_acts(profile_page.in_character, ARRAY['post'::text, 'spin'::text, 'card'::text], 0, 5) AS ids
         ), acts5 AS (
          (SELECT a.id,
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
           WHERE ((a."character" = profile_page.in_character) AND (a.kind = ANY (ARRAY['post'::text, 'spin'::text, 'card'::text])) AND (( SELECT sid.ids FROM sid) IS NULL))
           ORDER BY a.created_at DESC
          LIMIT 5)
          UNION ALL
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
           WHERE ((a.id = ANY (( SELECT sid.ids FROM sid)::uuid[])) AND (a."character" = profile_page.in_character))
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

create or replace function record_page(in_character uuid, in_kind text, in_page integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
 SET plan_cache_mode TO 'force_generic_plan'
 SET jit TO 'off'
AS $function$
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
         ), sid AS (
          -- the stand-in's page, read from the live veils (stand_in_acts, 0434); null for any other character
          SELECT stand_in_acts(record_page.in_character, w.kinds, (w.from_row)::integer, (CASE WHEN (k.kind = 'all'::text) THEN (w.base - w.from_row) ELSE (20)::bigint END)::integer) AS ids
            FROM w,
             k
         ), acts_read AS (
          (SELECT a.id,
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
                    FROM w)::text[])) AND (( SELECT sid.ids FROM sid) IS NULL))
           ORDER BY a.created_at DESC
          OFFSET ( SELECT w.from_row
                    FROM w)
          LIMIT ( SELECT
                         CASE
                             WHEN (k.kind = 'all'::text) THEN (w.base - w.from_row)
                             ELSE (20)::bigint
                         END AS "case"
                    FROM w,
                     k))
          UNION ALL
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
           WHERE ((a.id = ANY (( SELECT sid.ids FROM sid)::uuid[])) AND (a."character" = record_page.in_character))
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

-- ---------------------------------------------------------------------------------------------------- 4. play_row ----
-- 0412's play_row, its one statement word for word, now in plpgsql with no sequential scan (see this file's header, item 4): `into r`, then r, which is the row of nulls where 0412's returned a null for an Act that is no play
-- (play_post_drift reads `(play_row(p.play)).play is null` and `p is distinct from play_row(p.play)`, which answer alike). Same signature, owner, security and grants (create or replace keeps them).
create or replace function play_row(play uuid) returns play_post
language plpgsql stable security definer set search_path = public, pg_temp set enable_seqscan = off as $$
declare
  r play_post;
begin
    select a.id, a.target_act_id,
           case when a.kind = 'card' then coalesce(a.payload ->> 'card', '') else '' end,
           case when a.kind = 'card' then coalesce(a.payload ->> 'reach', 'post') else 'post' end,
           a.created_at,
           case when a.kind = 'set' then coalesce((ls.payload ->> 'until')::timestamptz, f.ends_at)
                else least((a.payload ->> 'ends')::timestamptz, pr.ends_at,
                           case when ck.drive is not null and coalesce(a.payload ->> 'reach', 'post') = 'post' and not (a.payload ? 'caught') then
                             (select coalesce(max(k.created_at) filter (where not card_ended(k.id)), max(k.created_at)) from acts k
                              where k.kind = 'card' and k.target_act_id = a.target_act_id and k.payload ->> 'card' = a.payload ->> 'card' and not (k.payload ? 'caught')
                                and coalesce(k.payload ->> 'reach', 'post') = 'post' and coalesce(k.payload ->> 'drive', k.id::text) = coalesce(a.payload ->> 'drive', a.id::text))
                             + span_interval(ck.drive -> 'lasts') end) end,
           case when a.kind = 'set' and ls.id is not null then
                  (select min(e.created_at) from acts e where e.kind = 'card_end' and e.target_act_id = ls.id)
                when a.kind = 'set' then
                  least((select min(s.created_at) from acts s where s.kind = 'spring' and (s.payload ->> 'set') = a.id::text),
                        (select min(tb.created_at) from acts tb where tb.kind = 'take_back' and (tb.payload ->> 'set') = a.id::text))
                else
                  least(case when a.payload ? 'caught' or a.payload ? 'instant' then a.created_at end,
                        (select min(e.created_at) from acts e where e.kind = 'card_end' and e.target_act_id = a.id),
                        rf.at,
                        (select min(c.created_at) from acts c where c.kind = 'card' and c.payload ? 'pierce' and (c.payload #>> '{pierce,by}') = a.id::text),
                        card_cut_at(a.id)) end,
           rf.play is null,
           a.kind = 'set' and exists (select 1 from acts s where s.kind = 'spring' and (s.payload ->> 'set') = a.id::text),
           coalesce((select sum(t.count) from reaction_tallies t where t.act = a.id), 0)::integer + (select count(*) from threads th where th.origin_act_id = a.id)::integer,
           case when a.kind = 'set' then (select min((s.payload ->> 'until')::timestamptz) from acts s where s.kind = 'spring' and (s.payload ->> 'set') = a.id::text and s.payload ->> 'did' = 'lockedOut'
                                                                     and not exists (select 1 from acts e where e.kind = 'card_end' and e.target_act_id = s.id)) end
    into r
    from acts a
    left join face_down f on f.play = a.id and a.kind = 'set'
    left join lateral (select s.id, s.payload from acts s where a.kind = 'set' and s.kind = 'spring' and (s.payload ->> 'set') = a.id::text and s.payload ->> 'did' = 'lockedOut'
                        order by s.created_at, s.id limit 1) ls on true
    left join play_reach pr on pr.play = a.id and a.kind = 'card'
    left join card_write_refunds rf on rf.play = a.id and a.kind = 'card'
    left join card_kinds ck on ck.key = a.payload ->> 'card' and a.kind = 'card'
    where a.id = play_row.play and a.kind in ('card', 'set') and a.target_act_id is not null;
  return r;
end $$;
