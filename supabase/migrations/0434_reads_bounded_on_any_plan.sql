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
--      Rebuilt here: the check is author_veil_covers(act), one call for each Act, which a planner cannot hash: it reads the Act's rows of post_veil_cover by their key (act, play), and for each play the veil by its key (post_veils_pkey),
--      its end by its key (card_end_written: acts_one_card_end, under 0425's settings and in its own order, so that acts_card_ends' scan with a filter costs a disabled node) and its refund by its key (card_write_refunds_pkey). It is post_veils_live's rule for one veil (author, not over, not ended, not refunded), read in that order, so an Act no veil covers costs one
--      probe of post_veil_cover and no row of `acts`. acts_public is otherwise 0395's, word for word.
--   2. pool_own_post_ids and pool_reply_ids (0425), issue #1080. 0425 left one path with no disabled node besides each helper's ordered index: acts_patrol_posts (thread, created_at desc, id desc) gives the thread's posts in the order
--      the helpers ask for, with the character (or the target) as a filter, so a planner that priced it below the ordered index read the thread's posts until it had n. Under empty statistics every candidate is estimated at one row
--      and the cheaper is the smaller index, which acts_patrol_posts is: forged empty statistics with relallvisible 0 (the visibility map's count, which 0425's test did not forge, and which the files before it leave as they leave it)
--      read 1241 rows in a 4,000-post thread and 941 in a 1,000-post one, #1080's own numbers.
--      Rebuilt here so that no other path is free of a disabled node: the character (or the target) is asked for as a range of one value (`between x and x`), which makes no equivalence class, and the order is asked for with it first
--      (`order by character desc, created_at desc, id desc`; `order by target_act_id, created_at desc, id desc`). Under the helpers' settings (no sequential scan, no bitmap scan, no sort, no incremental sort) that order comes without a
--      disabled node only from an index whose key is it under the query's equalities: acts_thread_posts (thread, character, created_at, id) where kind = 'post', read backward, and acts_target (target_act_id, kind, created_at desc, id
--      desc) where kind <> 'edit'. acts_patrol_posts, acts_character and acts_created each lack a column of it and cost a sort, a disabled node. No other index of `acts` is implied by kind = 'post'. The rows read are the rows returned.
--      Same signatures, owner, settings, grants and result as 0425's.
--
-- The tests: supabase/tests/0434-reads-bounded-on-any-plan.sql plants the veils and card_end Acts that make the hash cheap (tests.plant_live_veils, supabase/tests/setup/fixtures.sql: few, as CI had them, then many) and counts one probe under each statistics
-- state; 0424's, 0425's and 0426's guards now measure in the states that failed, on every run rather than on the runs whose earlier files left them: all three plant the veils and card_ends, 0425 and 0426 forge relallvisible 0
-- with their empty statistics, and 0425 leaves 20,000 rolled-back posts' dead entries in `acts`' indexes first. Each was run red against the definitions before this file.
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

-- Priced as what it is, an index probe for each row (cost 1000, about one random page read at the default costs; a plpgsql function is priced 100 unless it says, which is a tenth of that): priced at 100, the planner read
-- pool_signals' `tops` (0420) by the thread alone through acts_thread_seq_key and filtered the window, where at its true price it narrows to the window's posts first (acts_patrol_posts by thread and created_at), as 0420's test asks.
create function author_veil_covers(act uuid) returns boolean
language plpgsql stable cost 1000 security definer set search_path = public, pg_temp as $$
declare
  pl uuid;
begin
  if author_veil_covers.act is null then return false; end if;
  for pl in select c.play from post_veil_cover c where c.act = author_veil_covers.act loop
    continue when not exists (select 1 from post_veils v where v.play = pl and v.veil = 'author' and v.ends_at > now());
    continue when card_end_written(pl);
    continue when exists (select 1 from card_write_refunds r where r.play = pl);
    return true;
  end loop;
  return false;
end $$;
revoke execute on function author_veil_covers(uuid) from public, anon;
grant execute on function author_veil_covers(uuid) to authenticated, service_role, kayfabb_digest;

-- acts_public as 0395 wrote it (section 8), but for the author-veil check of its first two selects: `not author_veil_covers(a.id)` and `author_veil_covers(a.id)` where 0395 had `not exists (...)` and `exists (...)` over post_veil_cover
-- and post_veils_live. The columns, their order and every other expression are 0395's.
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
-- 0425's two helpers, same signatures, owner, settings and grants (create or replace keeps them), the n newest ids by (created_at desc, id desc) as before: see this file's header, item 2.
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
